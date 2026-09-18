"use node";

/**
 * OpenAI adapter for the Sombrey AI Coach's TextCompletionProvider.
 *
 * This is the ONLY file in the AI Coach layer allowed to import the
 * `openai` package or know that OpenAI is the current provider. Calls
 * OpenAI's API directly — no Hercules AI Gateway, no Hercules base URL,
 * no Hercules API key.
 *
 * The client is constructed lazily, inside the function that needs it,
 * not at module scope. Convex evaluates every convex/ module during
 * deployment analysis; a top-level `new OpenAI(...)` throws immediately
 * if OPENAI_API_KEY isn't configured yet, which fails deployment for
 * the whole backend. Lazy construction lets the backend deploy cleanly
 * even before the key is configured, and only errors when an AI Coach
 * capability actually runs — which is the correct behavior.
 */

import OpenAI from "openai";
import type {
  ChatMessage,
  CompletionOptions,
  TextCompletionProvider,
} from "./types.js";

/**
 * TEMPORARY V1 development configuration — not a permanent Sombrey AI
 * provider/model decision. `gpt-4o-mini` was chosen only because the
 * original Hercules-gateway model string ("openai/gpt-5-mini", with a
 * gateway-specific "openai/" namespace prefix) is not a real OpenAI API
 * model id and could not be carried forward without guessing. Override
 * with SOMBREY_AI_MODEL (a Convex environment variable) to change the
 * default without a code change; capability files can still override
 * per-call via `options.model`. Final model/provider selection is
 * pending a quality evaluation — see the Phase 2 cleanup report.
 */
const DEFAULT_MODEL = process.env.SOMBREY_AI_MODEL ?? "gpt-4o-mini";

function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not configured on this Convex deployment. " +
        "Set it in the Convex dashboard (Settings > Environment Variables) " +
        "before using any Sombrey AI Coach capability.",
    );
  }
  return new OpenAI({ apiKey });
}

function toOpenAiContent(content: ChatMessage["content"]) {
  if (typeof content === "string") return content;
  return content.map((part) =>
    part.type === "text"
      ? { type: "text" as const, text: part.text }
      : {
          type: "image_url" as const,
          image_url: { url: part.imageUrl, detail: part.detail ?? "auto" },
        },
  );
}

export const openAiTextProvider: TextCompletionProvider = {
  async complete(messages: ChatMessage[], options?: CompletionOptions): Promise<string> {
    const client = getClient();

    const response = await client.chat.completions.create({
      model: options?.model ?? DEFAULT_MODEL,
      messages: messages.map((m) => ({
        role: m.role,
        content: toOpenAiContent(m.content),
      })) as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      temperature: options?.temperature,
      max_tokens: options?.maxTokens,
      response_format:
        options?.responseFormat === "json" ? { type: "json_object" } : undefined,
      // Only forwarded when the caller asks for it — most models ignore an
      // unknown field, but keep it opt-in to avoid surprising errors.
      ...(options?.reasoningEffort
        ? { reasoning_effort: options.reasoningEffort }
        : {}),
    });

    return response.choices[0]?.message?.content ?? "";
  },
};
