"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import OpenAI from "openai";

function getClient() {
  return new OpenAI({
    baseURL: "https://ai-gateway.hercules.app/v1",
    apiKey: process.env.HERCULES_API_KEY,
  });
}

export const generateMealPlan = action({
  args: {
    targetCalories: v.number(),
    targetProtein: v.number(),
    targetCarbs: v.number(),
    targetFats: v.number(),
    dietaryPreferences: v.optional(v.string()),
    numberOfMeals: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Enforce authentication and premium subscription server-side
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });
    await ctx.runQuery(internal.ai.coachHelpers.getFitnessContext);
    const openai = getClient();
    const numMeals = args.numberOfMeals ?? 3;
    const dietaryInfo = args.dietaryPreferences
      ? `\nDietary preferences/restrictions: ${args.dietaryPreferences}`
      : "";

    const prompt = `You are a professional nutritionist helping create a meal plan.

Target Macros per day:
- Calories: ${args.targetCalories}
- Protein: ${args.targetProtein}g
- Carbs: ${args.targetCarbs}g
- Fats: ${args.targetFats}g${dietaryInfo}

Create a meal plan with ${numMeals} meals that hits these macro targets. For each meal:
1. Provide a meal name
2. List specific foods with amounts (e.g., "Chicken breast, 200g")
3. Calculate the macros for each food item

Format your response as a JSON array with this structure:
[
  {
    "name": "Meal name",
    "time": "Suggested time (e.g., 8:00 AM)",
    "foods": [
      {
        "name": "Food name",
        "amount": "Amount with unit",
        "protein": number,
        "carbs": number,
        "fats": number,
        "calories": number
      }
    ]
  }
]

Make the meals practical, delicious, and ensure the total macros are close to the targets.`;

    try {
      const response = await openai.chat.completions.create({
        model: "openai/gpt-5-mini",
        reasoning_effort: "minimal",
        messages: [
          {
            role: "system",
            content:
              "You are a professional nutritionist and meal planning expert. Always respond with valid JSON only, no markdown formatting.",
          },
          { role: "user", content: prompt },
        ],
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new ConvexError({
          code: "EXTERNAL_SERVICE_ERROR",
          message: "No response from AI",
        });
      }

      return JSON.parse(content);
    } catch (error) {
      if (error instanceof ConvexError) throw error;
      console.error("AI Meal Plan Error:", error);
      throw new ConvexError({
        code: "EXTERNAL_SERVICE_ERROR",
        message: "Failed to generate meal plan",
      });
    }
  },
});
