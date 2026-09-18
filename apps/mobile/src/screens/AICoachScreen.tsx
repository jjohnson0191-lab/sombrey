import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Screen, Button } from "@/ui/index.ts";
import { useAiCoach } from "@/features/ai/useAiCoach.ts";

type Message = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = ["Why is my readiness lower today?", "What should I eat before training?"];

/**
 * Sombrey Coach — real, working chat against convex/ai/sombreyCoach.ts,
 * an isolated Sombrey-specific action (its own system prompt, its own
 * context query) — not the legacy "GOAT WALK" persona in
 * convex/ai/coach.ts, which remains untouched for the legacy app.
 */
export function AICoachScreen() {
  const navigate = useNavigate();
  const { sendMessage } = useAiCoach();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [isComposing, setIsComposing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = async (text: string) => {
    const next: Message[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setDraft("");
    setError(null);
    setIsComposing(true);
    try {
      const { reply } = await sendMessage(next);
      setMessages([...next, { role: "assistant", content: reply }]);
    } catch {
      setError("Sombrey couldn't check your data just now.");
    } finally {
      setIsComposing(false);
    }
  };

  const lastAssistantReply = [...messages].reverse().find((m) => m.role === "assistant");

  return (
    <Screen scene="aiCoach" className="pt-14 pb-28">
      <p className="text-[11px] tracking-[0.12em] text-paper-soft">SOMBREY COACH</p>

      <div className="mt-10 flex flex-col gap-5">
        {messages.length === 0 && !isComposing && !error && (
          <div>
            <p className="text-[12px] text-ink-soft">Try asking:</p>
            <div className="mt-2 flex flex-col gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void ask(s)}
                  className="text-left text-[13px] text-ink/65"
                >
                  "{s}"
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <p
            key={i}
            className={
              m.role === "user"
                ? "text-right text-[13px] text-ink/70"
                : "text-[15px] leading-relaxed text-[#4A4234]"
            }
          >
            {m.content}
          </p>
        ))}

        {isComposing && <p className="text-[13px] text-ink-soft">Composing a response…</p>}

        {error && (
          <div>
            <p className="text-[13px] text-ink-soft">{error}</p>
            <button
              type="button"
              onClick={() => void ask(messages.at(-1)?.content ?? "")}
              className="mt-2 text-[13px] font-semibold text-accent-ink underline"
            >
              Try again
            </button>
          </div>
        )}

        {lastAssistantReply && !isComposing && (
          <Button variant="secondary" className="self-start" onClick={() => navigate("/train")}>
            Adjust today's workout
          </Button>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) void ask(draft.trim());
        }}
        className="fixed bottom-24 left-6 right-6 border-b border-ink/22 pb-3"
      >
        <div className="flex items-baseline justify-between">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask Sombrey anything"
            className="w-full bg-transparent text-[14px] text-ink placeholder:text-ink/42 outline-none"
          />
          <button type="submit" aria-label="Send" className="text-[16px] text-ink">
            ↑
          </button>
        </div>
      </form>
    </Screen>
  );
}
