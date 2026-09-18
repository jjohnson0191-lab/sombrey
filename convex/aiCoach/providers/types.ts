/**
 * Sombrey AI Coach — provider abstraction.
 *
 * Every AI capability (coach chat, plan generation, plan modification,
 * meal suggestions, check-in assessment, progress insights) is written
 * against this interface, never against a specific vendor SDK. Swapping
 * the underlying LLM provider means writing a new adapter here and
 * changing one line in providers/index.ts — no capability file, and
 * nothing in the iOS app, Convex data model, or workout/nutrition/
 * progress domains, needs to change.
 *
 * This file has zero provider-specific code — no OpenAI import, no
 * Hercules reference.
 */

export type ChatRole = "system" | "user" | "assistant";

export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; imageUrl: string; detail?: "low" | "high" | "auto" };

export interface ChatMessage {
  role: ChatRole;
  /** Plain text for ordinary messages, or parts for multimodal (vision) input. */
  content: string | ChatContentPart[];
}

export interface CompletionOptions {
  /**
   * Model identifier, in whatever form the active provider expects.
   * Left to the adapter's own default when omitted — capability code
   * should not need to know real model names.
   */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "json" | "text";
  /** Only meaningful for providers/models that support it; ignored otherwise. */
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
}

/**
 * The one interface every AI Coach capability depends on for text/chat
 * (including multimodal chat — e.g. check-in body-composition estimation
 * sends photos as image_url parts through the same interface).
 */
export interface TextCompletionProvider {
  complete(messages: ChatMessage[], options?: CompletionOptions): Promise<string>;
}
