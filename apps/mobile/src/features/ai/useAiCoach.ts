import { useAction } from "convex/react";
import { api } from "@convex/_generated/api.js";

/**
 * The mobile app's only connection to the Sombrey AI Coach. This calls
 * convex/ai/sombreyCoach.ts — an isolated action with Sombrey's own
 * system prompt, NOT convex/ai/coach.ts (the legacy "GOAT WALK"
 * hypertrophy-coach persona used by the legacy web app). Nothing here
 * or anywhere downstream imports OpenAI (or any provider SDK) directly;
 * the backend's provider abstraction (convex/aiCoach/providers) is what
 * makes that true, and both coach actions share it.
 */
export function useAiCoach() {
  const chat = useAction(api.ai.sombreyCoach.chat);

  return {
    /** Send the current conversation, get the AI Coach's reply. */
    sendMessage: async (messages: Array<{ role: "user" | "assistant"; content: string }>) => {
      return chat({ messages });
    },
  };
}
