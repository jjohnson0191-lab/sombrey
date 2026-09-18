"use node";

/**
 * The single swap point for the Sombrey AI Coach's text/chat provider.
 *
 * Every AI Coach capability calls getTextProvider() and only ever talks
 * to the returned TextCompletionProvider interface. To replace the
 * underlying LLM vendor, write a new adapter next to openai.ts
 * implementing TextCompletionProvider, and change the one line below —
 * no capability file, and nothing outside convex/aiCoach, needs to
 * change.
 */

import type { TextCompletionProvider } from "./types.js";
import { openAiTextProvider } from "./openai.js";

export function getTextProvider(): TextCompletionProvider {
  return openAiTextProvider;
}

export type {
  ChatMessage,
  ChatContentPart,
  CompletionOptions,
  TextCompletionProvider,
} from "./types.js";
