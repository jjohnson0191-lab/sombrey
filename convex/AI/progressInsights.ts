"use node";

/**
 * AI Insights for progress analytics
 * Generates a short AI analysis of the user's progress trends.
 */

import { action } from "../_generated/server";
import { v } from "convex/values";
import type { ActionCtx } from "../_generated/server";

import OpenAI from "openai";

const openai = new OpenAI({
  baseURL: "https://ai-gateway.hercules.app/v1",
  apiKey: process.env.HERCULES_API_KEY,
});

export const generateInsights = action({
  args: {
    weightChange: v.optional(v.number()),
    bodyFatChange: v.optional(v.number()),
    totalWorkouts: v.number(),
    totalCheckIns: v.number(),
    currentWeek: v.optional(v.number()),
    planGoal: v.optional(v.string()),
    recentWeights: v.array(v.number()),
    workoutsThisWeek: v.number(),
  },
  handler: async (_ctx: ActionCtx, args): Promise<{ insights: string }> => {
    const prompt = `You are an expert fitness coach AI. Analyze this athlete's progress and provide 3-4 specific, actionable insights in plain text (no markdown). Be encouraging but honest.

Plan Goal: ${args.planGoal ?? "Not specified"}
Current Week: ${args.currentWeek ?? "N/A"} / 12
Total Workouts: ${args.totalWorkouts}
Workouts This Week: ${args.workoutsThisWeek}
Total Check-ins: ${args.totalCheckIns}
Weight Change: ${args.weightChange !== undefined && args.weightChange !== null ? `${args.weightChange > 0 ? "+" : ""}${args.weightChange} kg` : "Not enough data"}
Body Fat Change: ${args.bodyFatChange !== undefined && args.bodyFatChange !== null ? `${args.bodyFatChange > 0 ? "+" : ""}${args.bodyFatChange}%` : "Not enough data"}
Recent Weights (oldest to newest): ${args.recentWeights.length > 0 ? args.recentWeights.join(", ") + " kg" : "Not enough data"}

Provide concise, specific insights. Focus on: trend direction, adherence, suggestions if progress stalls, and what's working well. Keep it to 3-4 sentences maximum.`;

    const response = await openai.chat.completions.create({
      model: "openai/gpt-5-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 250,
    });

    const insights = response.choices[0]?.message?.content ?? "Keep up your consistent effort — results come from showing up every week.";
    return { insights };
  },
});
