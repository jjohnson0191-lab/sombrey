"use node";

import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel.d.ts";
import OpenAI from "openai";

function getClient() {
  return new OpenAI({
    baseURL: "https://ai-gateway.hercules.app/v1",
    apiKey: process.env.HERCULES_API_KEY,
  });
}

type OnboardingInput = {
  primaryGoal: "build_muscle" | "lose_fat" | "recomp";
  currentWeightKg: number;
  heightCm: number;
  age: number;
  sex: "male" | "female" | "other";
  trainingExperience: "beginner" | "intermediate" | "advanced";
  trainingDaysPerWeek: number;
  gymAccess: "full_gym" | "home_gym" | "bodyweight";
  dietaryPreference: string;
  allergiesRestrictions?: string;
  targetWeightKg?: number;
  preferredSplit?: string;
};

type Exercise = { name: string; sets: number; reps: string; rest?: string; notes?: string };
type WorkoutDay = { dayName: string; exercises: Exercise[] };
type Meal = { name: string; time?: string; calories?: number; suggestions: string[] };
type WeekDay = { day: string; type: string; focus?: string };

type GeneratedPlan = {
  workoutSplit: string;
  workoutDays: WorkoutDay[];
  macroTargets: { calories: number; protein: number; carbs: number; fats: number };
  meals: Meal[];
  weeklySchedule: WeekDay[];
  coachNotes?: string;
};

export const generatePlanAction = internalAction({
  args: {
    userId: v.id("users"),
    planId: v.id("aiGeneratedPlans"),
    onboardingData: v.object({
      primaryGoal: v.union(v.literal("build_muscle"), v.literal("lose_fat"), v.literal("recomp")),
      currentWeightKg: v.number(),
      heightCm: v.number(),
      age: v.number(),
      sex: v.union(v.literal("male"), v.literal("female"), v.literal("other")),
      trainingExperience: v.union(v.literal("beginner"), v.literal("intermediate"), v.literal("advanced")),
      trainingDaysPerWeek: v.number(),
      gymAccess: v.union(v.literal("full_gym"), v.literal("home_gym"), v.literal("bodyweight")),
      dietaryPreference: v.string(),
      allergiesRestrictions: v.optional(v.string()),
      targetWeightKg: v.optional(v.number()),
      preferredSplit: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const d = args.onboardingData as OnboardingInput;
    const planId = args.planId as Id<"aiGeneratedPlans">;

    const GOAL_LABELS: Record<string, string> = {
      build_muscle: "Build Muscle (Hypertrophy)",
      lose_fat: "Lose Fat (Cut)",
      recomp: "Body Recomposition",
    };

    const prompt = `You are an elite strength and conditioning coach. Create a complete personalised fitness plan for this athlete.

ATHLETE PROFILE:
- Goal: ${GOAL_LABELS[d.primaryGoal]}
- Age: ${d.age}
- Sex: ${d.sex}
- Current weight: ${d.currentWeightKg}kg
- Height: ${d.heightCm}cm
- Target weight: ${d.targetWeightKg ? d.targetWeightKg + "kg" : "not specified"}
- Training experience: ${d.trainingExperience}
- Training days per week: ${d.trainingDaysPerWeek}
- Gym access: ${d.gymAccess.replace(/_/g, " ")}
- Dietary preference: ${d.dietaryPreference}
- Allergies/restrictions: ${d.allergiesRestrictions || "none"}
- Preferred split: ${d.preferredSplit || "AI will decide"}

Return ONLY valid JSON matching this schema (no markdown, no prose):
{
  "workoutSplit": "string (e.g. Push/Pull/Legs, Upper/Lower, Full Body)",
  "workoutDays": [
    {
      "dayName": "string (e.g. Push Day A)",
      "exercises": [
        {
          "name": "string",
          "sets": number,
          "reps": "string (e.g. 8-10 or 12)",
          "rest": "string (e.g. 90s)",
          "notes": "string (optional, technique cue)"
        }
      ]
    }
  ],
  "macroTargets": {
    "calories": number,
    "protein": number,
    "carbs": number,
    "fats": number
  },
  "meals": [
    {
      "name": "string (e.g. Breakfast)",
      "time": "string (optional, e.g. 7:00 AM)",
      "calories": number,
      "suggestions": ["string", "string", "string"]
    }
  ],
  "weeklySchedule": [
    {
      "day": "Monday",
      "type": "string (e.g. Push, Pull, Legs, Rest, Cardio)",
      "focus": "string (optional)"
    }
  ],
  "coachNotes": "string (2-3 sentence personalised coaching note)"
}

Requirements:
- workoutDays must have exactly ${d.trainingDaysPerWeek} training days (not rest days)
- weeklySchedule must have exactly 7 entries (Mon-Sun)
- macros must be calculated precisely for the athlete's goal, weight, and height
- protein should be 1.8-2.2g per kg of bodyweight for muscle building, 2.0-2.4g for cut
- meals should be ${d.trainingDaysPerWeek >= 4 ? 5 : 4} meals
- Keep exercises practical and appropriate for ${d.gymAccess.replace(/_/g, " ")}
- Respect dietary preference: ${d.dietaryPreference}
- IMPORTANT: Every exercise MUST use exactly 4 sets with this rep structure: sets=4, reps="15/12/10/8"
  This is Week 1 baseline for progressive overload. Do NOT use any other rep scheme.
  The only exception is explicit bodyweight endurance cardio (e.g. plank holds, treadmill).
- reps field must always be the string "15/12/10/8" for all working sets`;

    try {
      const openai = getClient();
      const response = await openai.chat.completions.create({
        model: "openai/gpt-5-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      });

      const raw = response.choices[0]?.message?.content ?? "{}";
      const plan = JSON.parse(raw) as GeneratedPlan;

      await ctx.runMutation(internal.premiumOnboarding.savePlan, {
        planId,
        workoutSplit: plan.workoutSplit ?? "Custom",
        workoutDays: (plan.workoutDays ?? []).map((d) => ({
          dayName: d.dayName,
          exercises: (d.exercises ?? []).map((e) => ({
            name: e.name,
            sets: e.sets ?? 3,
            reps: String(e.reps ?? "10"),
            rest: e.rest,
            notes: e.notes,
          })),
        })),
        macroTargets: {
          calories: Math.round(plan.macroTargets?.calories ?? 2000),
          protein: Math.round(plan.macroTargets?.protein ?? 150),
          carbs: Math.round(plan.macroTargets?.carbs ?? 200),
          fats: Math.round(plan.macroTargets?.fats ?? 60),
        },
        meals: (plan.meals ?? []).map((m) => ({
          name: m.name,
          time: m.time,
          calories: m.calories ? Math.round(m.calories) : undefined,
          suggestions: m.suggestions ?? [],
        })),
        weeklySchedule: (plan.weeklySchedule ?? []).map((s) => ({
          day: s.day,
          type: s.type,
          focus: s.focus,
        })),
        coachNotes: plan.coachNotes,
      });
    } catch (error) {
      console.error("AI plan generation failed:", error);
      await ctx.runMutation(internal.premiumOnboarding.markPlanError, { planId });
    }
  },
});
