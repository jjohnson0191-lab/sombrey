"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import OpenAI from "openai";

const openai = new OpenAI({
  baseURL: "https://ai-gateway.hercules.app/v1",
  apiKey: process.env.HERCULES_API_KEY,
});

type BodyCompEstimate = {
  estimatedBodyFatPct: number | null;
  estimatedBMI: number | null;
};

/** Estimate body fat % and BMI from photos + metrics using vision */
async function estimateBodyComposition(
  photoUrls: string[],
  weightKg: number,
  heightCm: number | null,
): Promise<BodyCompEstimate> {
  if (photoUrls.length === 0 || !heightCm) {
    // Calculate BMI from metrics alone if we have height
    const bmi = heightCm ? parseFloat((weightKg / Math.pow(heightCm / 100, 2)).toFixed(1)) : null;
    return { estimatedBodyFatPct: null, estimatedBMI: bmi };
  }

  const bmi = parseFloat((weightKg / Math.pow(heightCm / 100, 2)).toFixed(1));

  try {
    const imageContents = photoUrls.map((url) => ({
      type: "image_url" as const,
      image_url: { url, detail: "low" as const },
    }));

    const response = await openai.chat.completions.create({
      model: "openai/gpt-5-mini",
      messages: [
        {
          role: "system",
          content: `You are an AI fitness coach. Based on the physique photos and body metrics, estimate the user's body fat percentage as a trend indicator (not a medical measurement). Return ONLY a JSON object like: {"bodyFatPct": 18.5}. Be conservative and realistic. For males: 5-35% range typical. For females: 12-45% range typical.`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Weight: ${weightKg}kg, Height: ${heightCm}cm, BMI: ${bmi}. Estimate body fat % from photos.`,
            },
            ...imageContents,
          ],
        },
      ],
      max_tokens: 60,
      response_format: { type: "json_object" },
    });

    const raw = response.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as { bodyFatPct?: number };
    const bf = parsed.bodyFatPct;
    return {
      estimatedBodyFatPct: typeof bf === "number" && bf > 0 && bf < 60 ? parseFloat(bf.toFixed(1)) : null,
      estimatedBMI: bmi,
    };
  } catch {
    return { estimatedBodyFatPct: null, estimatedBMI: bmi };
  }
}

export const assessCheckIn = internalAction({
  args: {
    checkInId: v.id("weeklyCheckIns"),
    userId: v.id("users"),
    planId: v.union(v.id("aiGeneratedPlans"), v.null()),
  },
  handler: async (ctx, args): Promise<void> => {
    try {
      // Fetch check-in + plan data via internal queries
      const checkIn = await ctx.runQuery(internal.ai.checkInHelpers.getCheckIn, {
        checkInId: args.checkInId,
      });
      if (!checkIn) {
        await ctx.runMutation(internal.weeklyCheckIns.markAssessmentError, { checkInId: args.checkInId });
        return;
      }

      const plan = args.planId
        ? await ctx.runQuery(internal.ai.checkInHelpers.getPlan, { planId: args.planId })
        : null;

      // Resolve photo URLs for body composition analysis
      const photoStorageIds = [
        checkIn.frontPhotoStorageId,
        checkIn.sidePhotoStorageId,
        checkIn.backPhotoStorageId,
      ].filter(Boolean);

      const photoUrls: string[] = [];
      for (const storageId of photoStorageIds) {
        if (storageId) {
          const url = await ctx.runQuery(internal.ai.checkInHelpers.getStorageUrl, { storageId });
          if (url) photoUrls.push(url);
        }
      }

      // Estimate body composition from photos (if available)
      const user = await ctx.runQuery(internal.ai.checkInHelpers.getUserById, { userId: args.userId });
      const bodyComp = await estimateBodyComposition(
        photoUrls,
        checkIn.weightKg,
        user?.heightCm ?? null,
      );

      const isInitial = checkIn.isInitialCheckIn === true;

      // ─── Macro Adjustment Logic (carbs-first rules) ────────────────────────────
      // Gather the two most recent non-initial check-ins to compute weight trend
      let macroGuidance = "";

      if (!isInitial && plan && plan.primaryGoal) {
        // Compute weekly weight change: use initial check-in weight as baseline
        const currentWeight = checkIn.weightKg;
        // Find the baseline (initial) check-in for this plan
        const baselineCheckIn = await ctx.runQuery(internal.ai.checkInHelpers.getBaselineCheckIn, {
          userId: args.userId,
          planId: plan._id,
        });
        const planStartWeight = baselineCheckIn?.weightKg ?? null;

        // Derive weekly % change from plan start if available
        let weeklyWeightChangePct: number | null = null;
        if (planStartWeight && checkIn.weekNumber > 1) {
          const totalChangePct = ((currentWeight - planStartWeight) / planStartWeight) * 100;
          weeklyWeightChangePct = totalChangePct / (checkIn.weekNumber - 1);
        }

        const currentCalories = plan.macroTargets.calories;
        const currentProtein = plan.macroTargets.protein;
        const currentFats = plan.macroTargets.fats;
        const currentCarbs = plan.macroTargets.carbs;

        // Determine if adjustment is needed based on goal + 2-indicator rule
        const goal = plan.primaryGoal as string;
        let calAdjustment = 0;
        let adjustmentReason = "";

        if (goal === "lose_fat") {
          if (weeklyWeightChangePct !== null) {
            if (weeklyWeightChangePct > -0.4 && weeklyWeightChangePct <= 0) {
              // Less than 0.4% loss per week → reduce calories
              calAdjustment = -125;
              adjustmentReason = "weight loss below target rate (<0.4%/week)";
            } else if (weeklyWeightChangePct < -1.2) {
              // More than 1.2% loss per week → increase calories (muscle loss risk)
              calAdjustment = +100;
              adjustmentReason = "weight loss too aggressive (>1.2%/week)";
            }
          }
        } else if (goal === "build_muscle") {
          if (weeklyWeightChangePct !== null) {
            if (weeklyWeightChangePct >= 0 && weeklyWeightChangePct < 0.25) {
              // Less than 0.25% gain per week → increase calories
              calAdjustment = +125;
              adjustmentReason = "muscle gain below target rate (<0.25%/week)";
            } else if (weeklyWeightChangePct > 0.75) {
              // More than 0.75% gain per week → reduce calories (excess fat gain)
              calAdjustment = -100;
              adjustmentReason = "weight gain too fast (>0.75%/week)";
            }
          }
        } else if (goal === "recomp") {
          // Body recomposition: small adjustments only
          const strengthDown = checkIn.strengthChange === "decreased";
          const recoveryPoor = checkIn.recoveryScore <= 2;
          if (strengthDown && recoveryPoor) {
            calAdjustment = +100;
            adjustmentReason = "strength stall + poor recovery";
          }
        }

        // Generate macro guidance only when an adjustment is warranted
        if (calAdjustment !== 0) {
          // Apply to carbs only — protein and fats remain fixed
          const carbCalAdjustment = calAdjustment;
          const carbGChange = Math.round(carbCalAdjustment / 4); // 4 kcal per gram of carb
          const newCarbs = Math.max(50, currentCarbs + carbGChange);
          const newCalories = currentCalories + carbCalAdjustment;

          macroGuidance = `\n\n**Macro Adjustment Recommendation:** Based on ${adjustmentReason}, consider ${calAdjustment > 0 ? "increasing" : "decreasing"} calories by ${Math.abs(calAdjustment)} kcal (protein stays at ${currentProtein}g, fats stay at ${currentFats}g, adjust carbs from ${currentCarbs}g → ${newCarbs}g). New target: ${newCalories} kcal/day.`;
        }
      }

      const systemPrompt = isInitial
        ? `You are an elite AI fitness coach. This is a user's BASELINE check-in before starting their personalized 12-week program. Write a 2-3 paragraph motivating assessment covering: (1) their current baseline, (2) what to expect over the 12 weeks, (3) one focused tip to start strong. Be encouraging and energetic. No bullet points or headers.`
        : `You are an elite AI fitness coach. Analyze the user's weekly check-in and write a personalized 3-4 paragraph assessment. Be direct, specific, and encouraging. Cover: (1) progress observations, (2) performance analysis, (3) concrete adjustments for next week. Write in coach voice — no headers or bullet points.`;

      const bodyCompNote = bodyComp.estimatedBodyFatPct
        ? `\nEstimated body fat: ~${bodyComp.estimatedBodyFatPct}% | BMI: ${bodyComp.estimatedBMI}`
        : bodyComp.estimatedBMI
        ? `\nEstimated BMI: ${bodyComp.estimatedBMI}`
        : "";

      const userPrompt = [
        `${isInitial ? "BASELINE" : `Week ${checkIn.weekNumber}`} Check-In | ${checkIn.checkInDate}`,
        `Weight: ${checkIn.weightKg}kg`,
        checkIn.waistCm ? `Waist: ${checkIn.waistCm}cm` : null,
        checkIn.chestCm ? `Chest: ${checkIn.chestCm}cm` : null,
        checkIn.armsCm ? `Arms: ${checkIn.armsCm}cm` : null,
        checkIn.legsCm ? `Legs: ${checkIn.legsCm}cm` : null,
        bodyCompNote || null,
        `Energy: ${checkIn.energyLevel}/5 | Sleep: ${checkIn.sleepQuality}/5 | Recovery: ${checkIn.recoveryScore}/5`,
        `Hunger: ${checkIn.hungerLevel}/5 | Strength: ${checkIn.strengthChange}`,
        checkIn.challenges ? `Challenges: ${checkIn.challenges}` : null,
        checkIn.notes ? `Notes: ${checkIn.notes}` : null,
        plan
          ? `Plan — Goal: ${plan.primaryGoal} | Split: ${plan.workoutSplit} | Calories: ${plan.macroTargets.calories}kcal | Protein: ${plan.macroTargets.protein}g`
          : null,
        photoUrls.length > 0 ? `Progress photos submitted: ${photoUrls.length}` : null,
        macroGuidance || null,
      ]
        .filter(Boolean)
        .join("\n");

      const completion = await openai.chat.completions.create({
        model: "openai/gpt-5-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 700,
        temperature: 0.72,
      });

      const assessment = completion.choices[0]?.message?.content ?? "Assessment unavailable — please try again.";

      await ctx.runMutation(internal.weeklyCheckIns.saveAssessment, {
        checkInId: args.checkInId,
        assessment,
        estimatedBodyFatPct: bodyComp.estimatedBodyFatPct ?? undefined,
        estimatedBMI: bodyComp.estimatedBMI ?? undefined,
      });
    } catch (err) {
      console.error("AI check-in assessment failed:", err);
      await ctx.runMutation(internal.weeklyCheckIns.markAssessmentError, {
        checkInId: args.checkInId,
      });
    }
  },
});
