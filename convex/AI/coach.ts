"use node";

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

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

// Fetch the current user's fitness context for the AI
export const getCoachContext = action({
  args: {},
  handler: async (ctx): Promise<string> => {
    const context = await ctx.runQuery(internal.ai.coachHelpers.getFitnessContext);
    return context;
  },
});

// Main chat action — takes conversation history and returns AI reply
export const chat = action({
  args: {
    messages: v.array(
      v.object({
        role: v.union(v.literal("user"), v.literal("assistant")),
        content: v.string(),
      })
    ),
  },
  handler: async (ctx, args): Promise<{ reply: string }> => {
    // Load user fitness context
    const fitnessContext = await ctx.runQuery(internal.ai.coachHelpers.getFitnessContext);

    const openai = getClient();

    const systemPrompt = `You are an elite personal fitness coach AI for GOAT WALK — a hypertrophy-focused training platform.

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

SUBSTITUTION REQUESTS:
When the athlete asks to replace an exercise or meal (e.g. "replace barbell squat with leg press", "swap chicken for fish", "make my breakfast vegetarian"):
1. Acknowledge the substitution clearly
2. Confirm the new choice is appropriate (same muscle group, same macros)
3. Give specific sets/reps/instructions for the replacement
4. Note any adjustments needed (e.g. "increase weight slightly")
5. Tell them to visit the AI Plan page to see their updated plan (it updates automatically when they regenerate)`;

    try {
      const response = await openai.chat.completions.create({
        model: "openai/gpt-5-mini",
        reasoning_effort: "minimal",
        messages: [
          { role: "system", content: systemPrompt },
          ...(args.messages as ChatMessage[]),
        ],
      });

      const reply = response.choices[0]?.message?.content ?? "I couldn't generate a response. Please try again.";
      return { reply };
    } catch (error) {
      console.error("AI Coach Error:", error);
      throw new ConvexError({
        code: "EXTERNAL_SERVICE_ERROR",
        message: "Failed to get AI response. Please try again.",
      });
    }
  },
});
