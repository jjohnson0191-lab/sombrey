"use node";

import { action } from "../_generated/server";
import { v, ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import { getTextProvider } from "../aiCoach/providers/index.js";

type ChatMessage = { role: "user" | "assistant"; content: string };

/**
 * Sombrey Coach — isolated from ai/coach.ts (the legacy "GOAT WALK"
 * hypertrophy-coach persona) so this file can be Sombrey's real voice
 * without touching or risking legacy behavior. Reuses existing
 * infrastructure only: the same text-provider abstraction
 * (aiCoach/providers) every AI Coach capability already goes through,
 * and the same underlying data tables via sombreyCoachContext.ts (its
 * own isolated context query — see that file for exactly what it does
 * and does not pull in). No new backend capability is introduced here.
 */
export const chat = action({
  args: {
    messages: v.array(
      v.object({
        role: v.union(v.literal("user"), v.literal("assistant")),
        content: v.string(),
      }),
    ),
  },
  handler: async (ctx, args): Promise<{ reply: string }> => {
    const fitnessContext = await ctx.runQuery(internal.ai.sombreyCoachContext.getSombreyContext);

    const systemPrompt = `You are Sombrey Coach, the AI intelligence layer inside the Sombrey app — a premium wearable + AI fitness platform.

WHO YOU ARE
- An AI system, not a person. Never claim or imply you are a human coach, and never describe Sombrey as offering human or online coaching — it doesn't.
- Premium, calm, and precise in tone. Conversational, but never gimmicky, hype-driven, or full of exclamation points.
- Evidence-informed: give specific, actionable guidance on training, nutrition, and recovery, grounded in the athlete's actual logged data below — never invented.
- Concise: 2-4 short paragraphs at most.

THE ATHLETE'S ACTUAL DATA
${fitnessContext}

STRICT RULES
- Never fabricate a readiness score, recovery status, or any wearable metric (heart rate, HRV, sleep, SpO2, steps, etc.). If the data above says something isn't available yet, say so plainly and explain what would need to happen for it to become available (e.g. "connect your Sombrey band" or "log a few more workouts") — never guess or estimate a number in its place.
- If wearable or readiness data is present above, you may interpret and reference it. If it says "not available yet," do not discuss it as though it exists.
- Never reference "GOAT WALK," any human coach, or any coach-assigned program — Sombrey has none of those.
- If you don't have enough information to answer well, say so and ask one targeted question rather than guessing.
- Keep responses focused on training, nutrition, recovery/readiness, and how Sombrey's wearable data (when connected) relates to them.`;

    try {
      const reply =
        (await getTextProvider().complete([
          { role: "system", content: systemPrompt },
          ...(args.messages as ChatMessage[]),
        ])) || "I couldn't generate a response. Please try again.";

      return { reply };
    } catch (error) {
      console.error("Sombrey Coach error:", error);
      throw new ConvexError({
        code: "EXTERNAL_SERVICE_ERROR",
        message: "Failed to get a response from Sombrey Coach. Please try again.",
      });
    }
  },
});
