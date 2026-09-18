import { useAction } from "convex/react";
import { api } from "@convex/_generated/api.js";

/**
 * The mobile app's only connection to the Sombrey AI Coach. This calls a
 * Convex action — nothing here or anywhere downstream imports OpenAI (or
 * any provider SDK). The backend's provider abstraction
 * (convex/aiCoach/providers, Phase 2) is what makes that true; this hook
 * just has to not break that boundary by reaching around it.
 */
export function useAiCoach() {
  const chat = useAction(api.ai.coach.chat);

  return {
    /** Send the current conversation, get the AI Coach's reply. */
    sendMessage: async (messages: Array<{ role: "user" | "assistant"; content: string }>) => {
      return chat({ messages });
    },
  };
}
