"use node";

/**
 * AI plan modification detection and application.
 *
 * Flow:
 *  1. chatAndDetect — sends user message to AI, detects if it's a plan change request,
 *     returns { reply, proposal? }  where proposal is shown as an approval card in the UI
 *  2. approveChange (mutation) — applies the patch to the live aiGeneratedPlan
 *  3. rejectChange (mutation)  — marks modification as rejected (no plan change)
 */

import { action } from "../_generated/server";
import { v, ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import OpenAI from "openai";

function getClient() {
  return new OpenAI({
    baseURL: "https://ai-gateway.hercules.app/v1",
    apiKey: process.env.HERCULES_API_KEY,
  });
}

// Types that mirror schema
type ChangeType =
  | "meal_substitution"
  | "exercise_substitution"
  | "macro_update"
  | "workout_split_change"
  | "general_update";

type Exercise = { name: string; sets: number; reps: string; rest?: string; notes?: string };
type WorkoutDay = { dayName: string; exercises: Exercise[] };
type Meal = { name: string; time?: string; calories?: number; suggestions: string[] };
type WeekDay = { day: string; type: string; focus?: string };
type MacroTargets = { calories: number; protein: number; carbs: number; fats: number };

type PlanPatch = {
  workoutSplit?: string;
  workoutDays?: WorkoutDay[];
  macroTargets?: MacroTargets;
  meals?: Meal[];
  weeklySchedule?: WeekDay[];
  coachNotes?: string;
};

type DetectedChange = {
  changeType: ChangeType;
  description: string;
  beforeSummary: string;
  afterSummary: string;
  patch: PlanPatch;
};

type ChatMessage = { role: "user" | "assistant"; content: string };

/**
 * Main action: send message to AI, detect if a plan change is requested,
 * persist proposal as pending_approval, and return both the chat reply and
 * an optional proposal id for the UI to render an approval card.
 */
export const chatAndDetect = action({
  args: {
    messages: v.array(
      v.object({
        role: v.union(v.literal("user"), v.literal("assistant")),
        content: v.string(),
      })
    ),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    reply: string;
    proposalId: string | null;
    proposal: {
      changeType: ChangeType;
      description: string;
      beforeSummary: string;
      afterSummary: string;
    } | null;
  }> => {
    // Load fitness context and current AI plan
    const fitnessContext = await ctx.runQuery(
      internal.ai.coachHelpers.getFitnessContext
    );
    const planInfo = await ctx.runQuery(
      internal.ai.planModificationHelpers.getCurrentPlanInfo
    );

    const openai = getClient();

    // ── Step 1: Generate the conversational reply ─────────────────────────────

    const chatSystemPrompt = `You are an elite personal fitness coach AI for GOAT WALK — a hypertrophy-focused training platform.

Your role is to provide expert, personalized coaching advice based on the athlete's real data. Be motivating, specific, and actionable.

ATHLETE'S CURRENT DATA:
${fitnessContext}

GUIDELINES:
- Reference the athlete's actual data when relevant (program name, workouts, macros, streak, AI plan)
- Give specific, science-backed advice on training, nutrition, recovery, and mindset
- Keep responses concise but substantive — 2-4 short paragraphs max
- Use an energetic, coach-like tone. Be direct and confident
- If you don't have enough data, ask targeted questions to help better
- Never make up data — only use what's provided above

PLAN MODIFICATION HANDLING:
When the athlete asks to change their AI-generated plan (e.g. replace an exercise, swap a meal, change macros, update their split):
1. Acknowledge their request warmly
2. Briefly explain why your proposed change is appropriate  
3. End your reply with exactly this sentence: "I've prepared a plan update for your review — approve it below to apply the change."
Do NOT describe the specific before/after details in the reply (those will appear in the approval card).
For general advice questions that do NOT require a plan change, respond normally without the above sentence.`;

    const chatResponse = await openai.chat.completions.create({
      model: "openai/gpt-5-mini",
      reasoning_effort: "minimal",
      messages: [
        { role: "system", content: chatSystemPrompt },
        ...(args.messages as ChatMessage[]),
      ],
    });

    const reply =
      chatResponse.choices[0]?.message?.content ??
      "I couldn't generate a response. Please try again.";

    // ── Step 2: Detect if this is a plan modification request ─────────────────

    const lastUserMessage =
      [...args.messages].reverse().find((m) => m.role === "user")?.content ?? "";

    // Only attempt detection if user message looks like a change request
    const changeTriggers = [
      "replace",
      "swap",
      "change",
      "update",
      "switch",
      "modify",
      "instead of",
      "substitute",
      "increase",
      "decrease",
      "adjust",
      "remove",
      "add",
      "make",
    ];
    const mightBeChange =
      changeTriggers.some((t) =>
        lastUserMessage.toLowerCase().includes(t)
      ) &&
      planInfo !== null; // can only modify if user has a plan

    if (!mightBeChange) {
      return { reply, proposalId: null, proposal: null };
    }

    // ── Step 3: Extract structured change proposal ────────────────────────────

    const detectionPrompt = `You are a fitness plan modification assistant. Given a user's request and their current plan, determine if a plan change is needed and what it should be.

CURRENT PLAN:
${planInfo ? JSON.stringify(planInfo.plan, null, 2) : "No plan available"}

USER REQUEST: "${lastUserMessage}"

If this is a plan modification request, return a JSON object. If it is just general advice with no plan change needed, return null.

Return ONLY valid JSON (no markdown) matching this schema, or the literal null:
{
  "changeType": "meal_substitution" | "exercise_substitution" | "macro_update" | "workout_split_change" | "general_update",
  "description": "One-sentence human-readable summary of the change",
  "beforeSummary": "Concise description of what will be replaced/changed (2-4 lines max)",
  "afterSummary": "Concise description of the new version (2-4 lines max)",
  "patch": {
    // Only include fields that actually change. Partial object.
    // For meal changes: include the full meals array with the modification applied
    // For exercise changes: include the full workoutDays array with the modification applied
    // For macro changes: include the updated macroTargets object
    // For split changes: include workoutSplit and/or weeklySchedule
  }
}

Rules:
- Only make changes relevant to the user's request
- For substitutions, preserve macros as closely as possible
- For exercise substitutions, preserve the same muscle group and volume
- Return null if no plan change is needed (pure advice question)`;

    let detectedChange: DetectedChange | null = null;

    try {
      const detectionResponse = await openai.chat.completions.create({
        model: "openai/gpt-5-mini",
        messages: [{ role: "user", content: detectionPrompt }],
        response_format: { type: "json_object" },
      });

      const raw =
        detectionResponse.choices[0]?.message?.content ?? "null";

      // The model returns a JSON object; if it represents "no change" it may have
      // a top-level "result": null or just be {}
      const parsed = JSON.parse(raw) as Record<string, unknown> | null;

      if (
        parsed &&
        parsed.changeType &&
        parsed.description &&
        parsed.patch
      ) {
        detectedChange = parsed as unknown as DetectedChange;
      }
    } catch (err) {
      console.error("Plan change detection failed:", err);
      // Non-fatal: just return the reply without a proposal
    }

    if (!detectedChange || !planInfo) {
      return { reply, proposalId: null, proposal: null };
    }

    // ── Step 4: Persist proposal as pending_approval ──────────────────────────

    const proposalId = await ctx.runMutation(
      internal.ai.planModificationHelpers.createProposal,
      {
        planId: planInfo.planId,
        changeType: detectedChange.changeType,
        description: detectedChange.description,
        beforeSummary: detectedChange.beforeSummary,
        afterSummary: detectedChange.afterSummary,
        patch: JSON.stringify(detectedChange.patch),
      }
    );

    return {
      reply,
      proposalId,
      proposal: {
        changeType: detectedChange.changeType,
        description: detectedChange.description,
        beforeSummary: detectedChange.beforeSummary,
        afterSummary: detectedChange.afterSummary,
      },
    };
  },
});
