import { useState, useRef, useEffect, useMemo } from "react";
import { Authenticated, AuthLoading, Unauthenticated, useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { SignInButton } from "@/components/ui/signin.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import {
  Send,
  Sparkles,
  User,
  RotateCcw,
  Zap,
  CheckCircle,
  XCircle,
  ClipboardEdit,
  ArrowRight,
  Bot,
} from "lucide-react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { cn } from "@/lib/utils.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

type ChangeType =
  | "meal_substitution"
  | "exercise_substitution"
  | "macro_update"
  | "workout_split_change"
  | "general_update";

type ProposalData = {
  proposalId: string;
  changeType: ChangeType;
  description: string;
  beforeSummary: string;
  afterSummary: string;
  status: "pending" | "approved" | "rejected";
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  // If this assistant message includes a plan change proposal
  proposal?: ProposalData;
};

// ─── Change type labels ───────────────────────────────────────────────────────

const CHANGE_TYPE_LABELS: Record<ChangeType, string> = {
  meal_substitution: "Meal Update",
  exercise_substitution: "Exercise Update",
  macro_update: "Macro Targets Update",
  workout_split_change: "Training Split Update",
  general_update: "Plan Update",
};

// ─── Suggested Prompts ────────────────────────────────────────────────────────

const SUGGESTED_PROMPTS = [
  "How should I structure my workout this week?",
  "Am I hitting my protein targets? Any tips?",
  "Replace barbell squat with leg press",
  "Can you review my recent training frequency?",
  "Replace chicken with salmon in my meal plan",
  "How do I speed up muscle recovery?",
];

// ─── Plan Proposal Card ───────────────────────────────────────────────────────

function PlanProposalCard({
  proposal,
  onApprove,
  onReject,
}: {
  proposal: ProposalData;
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
}) {
  const [loading, setLoading] = useState<"approve" | "reject" | null>(null);

  const handleApprove = async () => {
    setLoading("approve");
    await onApprove(proposal.proposalId);
    setLoading(null);
  };

  const handleReject = async () => {
    setLoading("reject");
    await onReject(proposal.proposalId);
    setLoading(null);
  };

  if (proposal.status === "approved") {
    return (
      <div className="mt-3 rounded-xl border border-green-500/30 bg-green-500/10 px-4 py-3 flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
        <CheckCircle className="w-4 h-4 shrink-0" />
        <span>Plan updated successfully. Visit <Link to="/ai-plan" className="underline font-medium">AI Plan</Link> to see the changes.</span>
      </div>
    );
  }

  if (proposal.status === "rejected") {
    return (
      <div className="mt-3 rounded-xl border border-border bg-muted/40 px-4 py-3 flex items-center gap-2 text-sm text-muted-foreground">
        <XCircle className="w-4 h-4 shrink-0" />
        <span>Change cancelled — your plan was not modified.</span>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="mt-3 rounded-xl border border-primary/30 bg-card overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-primary/5 border-b border-primary/20">
        <ClipboardEdit className="w-4 h-4 text-primary shrink-0" />
        <span className="text-xs font-semibold text-primary uppercase tracking-wide">
          {CHANGE_TYPE_LABELS[proposal.changeType]}
        </span>
        <Badge className="ml-auto bg-amber-500/15 text-amber-600 border-amber-500/30 text-[10px] px-1.5 py-0">
          Awaiting Approval
        </Badge>
      </div>

      {/* Description */}
      <div className="px-4 pt-3 pb-2">
        <p className="text-sm font-medium">{proposal.description}</p>
      </div>

      {/* Before / After diff */}
      <div className="px-4 pb-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="rounded-lg bg-red-500/8 border border-red-500/20 px-3 py-2">
          <p className="text-[10px] font-semibold text-red-500 uppercase tracking-wide mb-1">Before</p>
          <p className="text-xs text-muted-foreground whitespace-pre-line leading-relaxed">{proposal.beforeSummary}</p>
        </div>
        <div className="flex sm:contents items-start gap-2">
          <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0 mt-4 hidden sm:block" />
          <div className="flex-1 rounded-lg bg-green-500/8 border border-green-500/20 px-3 py-2">
            <p className="text-[10px] font-semibold text-green-600 uppercase tracking-wide mb-1">After</p>
            <p className="text-xs text-muted-foreground whitespace-pre-line leading-relaxed">{proposal.afterSummary}</p>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 px-4 pb-3">
        <Button
          size="sm"
          className="flex-1 cursor-pointer bg-green-600 hover:bg-green-700 text-white"
          onClick={() => void handleApprove()}
          disabled={loading !== null}
        >
          {loading === "approve" ? (
            <Spinner className="w-3.5 h-3.5 mr-1.5" />
          ) : (
            <CheckCircle className="w-3.5 h-3.5 mr-1.5" />
          )}
          Approve Change
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="flex-1 cursor-pointer border border-border text-muted-foreground hover:text-foreground"
          onClick={() => void handleReject()}
          disabled={loading !== null}
        >
          {loading === "reject" ? (
            <Spinner className="w-3.5 h-3.5 mr-1.5" />
          ) : (
            <XCircle className="w-3.5 h-3.5 mr-1.5" />
          )}
          Cancel
        </Button>
      </div>
    </motion.div>
  );
}

// ─── Message Bubble ───────────────────────────────────────────────────────────

function MessageBubble({
  message,
  onApproveProposal,
  onRejectProposal,
}: {
  message: Message;
  onApproveProposal: (proposalId: string) => Promise<void>;
  onRejectProposal: (proposalId: string) => Promise<void>;
}) {
  const isUser = message.role === "user";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className={cn("flex gap-3", isUser && "flex-row-reverse")}
    >
      {/* Avatar */}
      <div
        className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-1",
          isUser ? "bg-primary/20" : "bg-muted"
        )}
      >
        {isUser ? (
          <User className="w-4 h-4 text-primary" />
        ) : (
          <Bot className="w-4 h-4 text-muted-foreground" />
        )}
      </div>

      {/* Bubble + optional proposal card */}
      <div className={cn("max-w-[80%]", isUser ? "items-end" : "items-start")}>
        <div
          className={cn(
            "rounded-2xl px-4 py-3 text-sm leading-relaxed",
            isUser
              ? "bg-primary text-primary-foreground rounded-tr-sm"
              : "bg-card border border-border rounded-tl-sm"
          )}
        >
          {message.content.split("\n").map((line, i, arr) => (
            <span key={i}>
              {line}
              {i < arr.length - 1 && <br />}
            </span>
          ))}
          <div
            className={cn(
              "text-[10px] mt-1.5 opacity-60",
              isUser ? "text-right" : "text-left"
            )}
          >
            {message.timestamp.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
        </div>

        {/* Plan proposal card below the message bubble */}
        {message.proposal && (
          <PlanProposalCard
            proposal={message.proposal}
            onApprove={onApproveProposal}
            onReject={onRejectProposal}
          />
        )}
      </div>
    </motion.div>
  );
}

// ─── Typing Indicator ─────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      className="flex gap-3"
    >
      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
        <Sparkles className="w-4 h-4 text-primary" />
      </div>
      <div className="bg-card border border-primary/20 rounded-2xl rounded-tl-sm px-4 py-3 min-w-[200px]">
        <p className="text-[10px] font-bold uppercase tracking-wider text-primary mb-2">
          GOAT WALK AI is analyzing your request...
        </p>
        <div className="flex gap-1 items-center">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              className="w-1.5 h-1.5 bg-primary/60 rounded-full"
              animate={{ y: [0, -4, 0], opacity: [0.4, 1, 0.4] }}
              transition={{
                duration: 0.7,
                delay: i * 0.18,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            />
          ))}
        </div>
      </div>
    </motion.div>
  );
}

// ─── Chat UI ──────────────────────────────────────────────────────────────────

/**
 * #15 — Chat history is persisted in the `aiChatMessages` table.
 *
 * Strategy:
 * 1. On mount, load all messages for this user from the DB via `useQuery`.
 *    The query is reactive — it auto-updates when messages are added.
 * 2. When the user sends a message: save it to the DB first (mutation),
 *    then call the AI action with the full history.
 * 3. On success: save the AI reply to the DB (mutation).
 *    On failure: the user message IS in the DB (step 2) but the AI reply
 *    is not — the user can retry without losing their message.
 * 4. Proposal cards: `proposalId` is stored on the DB message row so they
 *    survive a reload. Proposal statuses are re-read reactively from the
 *    `planModifications` table via `getProposalStatuses`.
 * 5. "New chat" clears the DB history for this user.
 * 6. Authorization: the `getHistory` query only ever returns the caller's
 *    own messages — no user ID is passed from the client.
 */
function AiCoachChat() {
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── DB-backed history ─────────────────────────────────────────────────────
  const dbHistory = useQuery(api.ai.chatHistory.getHistory, {});
  const saveUserMessage = useMutation(api.ai.chatHistory.saveUserMessage);
  const saveAssistantMessage = useMutation(api.ai.chatHistory.saveAssistantMessage);
  const clearHistory = useMutation(api.ai.chatHistory.clearHistory);

  // ── Proposal status reactive query ────────────────────────────────────────
  // Collect all proposalIds from loaded messages so we can subscribe to their statuses
  const proposalIds = useMemo(
    () =>
      (dbHistory ?? [])
        .filter((m) => m.proposalId != null)
        .map((m) => m.proposalId as Id<"planModifications">),
    [dbHistory],
  );
  const proposalStatuses = useQuery(
    api.ai.planModificationHelpers.getProposalStatuses,
    proposalIds.length > 0 ? { proposalIds } : "skip",
  );

  // ── Proposal mutations ────────────────────────────────────────────────────
  const chatAndDetect = useAction(api.ai.planModifications.chatAndDetect);
  const approveChangeMutation = useMutation(api.ai.planModificationHelpers.approveChange);
  const rejectChangeMutation = useMutation(api.ai.planModificationHelpers.rejectChange);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [dbHistory, isThinking]);

  // ── Handle proposal approval ──────────────────────────────────────────────

  const handleApproveProposal = async (proposalId: string) => {
    try {
      await approveChangeMutation({
        proposalId: proposalId as Id<"planModifications">,
      });
      toast.success("Plan updated! Visit AI Plan to see changes.");
    } catch {
      toast.error("Failed to apply the change. Please try again.");
    }
  };

  const handleRejectProposal = async (proposalId: string) => {
    try {
      await rejectChangeMutation({
        proposalId: proposalId as Id<"planModifications">,
      });
      toast.info("Change cancelled.");
    } catch {
      toast.error("Failed to cancel the change. Please try again.");
    }
  };

  // ── Send message ──────────────────────────────────────────────────────────

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isThinking) return;

    setInput("");
    setIsThinking(true);

    // Step 1 — persist the user message immediately (survives network failures)
    await saveUserMessage({ content: trimmed });

    // Build the history array to pass to the AI (includes the new message)
    const currentHistory = (dbHistory ?? []).map((m) => ({
      role: m.role,
      content: m.content,
    }));
    const history = [...currentHistory, { role: "user" as const, content: trimmed }];

    try {
      const result = await chatAndDetect({ messages: history });

      // Step 2 — persist the successful AI reply
      await saveAssistantMessage({
        content: result.reply,
        proposalId: result.proposalId
          ? (result.proposalId as Id<"planModifications">)
          : undefined,
      });
    } catch (err) {
      const isTimeout = err instanceof Error && err.message.toLowerCase().includes("timeout");
      if (isTimeout) {
        toast.error("AI is taking longer than expected. Please try again in a moment.");
      } else if (!navigator.onLine) {
        toast.error("Connection lost. Please check your internet connection and try again.");
      } else {
        toast.error("GOAT WALK AI couldn't respond right now. Please try again.");
      }
    } finally {
      setIsThinking(false);
      textareaRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(input);
    }
  };

  const handleReset = async () => {
    await clearHistory({});
    setInput("");
  };

  // ── Build the Message[] array for rendering ───────────────────────────────
  // Map DB rows to the Message type that the existing render components expect.
  const messages: Message[] = useMemo(
    () =>
      (dbHistory ?? []).map((row) => {
        const proposal: ProposalData | undefined =
          row.proposalId && row.role === "assistant"
            ? {
                proposalId: row.proposalId,
                // changeType, description, beforeSummary, afterSummary are not stored
                // on the message row — they are only available at send time.
                // We store a placeholder so the card renders its status badge.
                changeType: "general_update" as ChangeType,
                description: "",
                beforeSummary: "",
                afterSummary: "",
                status:
                  proposalStatuses?.[row.proposalId] === "approved"
                    ? "approved"
                    : proposalStatuses?.[row.proposalId] === "rejected"
                      ? "rejected"
                      : "pending",
              }
            : undefined;

        return {
          id: row._id,
          role: row.role,
          content: row.content,
          timestamp: new Date(row._creationTime),
          proposal,
        };
      }),
    [dbHistory, proposalStatuses],
  );

  const isEmpty = messages.length === 0;
  const historyLoading = dbHistory === undefined;

  return (
    <div className="flex flex-col h-[calc(100vh-65px)]">
      {/* Chat header */}
      <div className="border-b border-border bg-card/30 px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm">AI Coach</span>
              <Badge className="bg-primary/15 text-primary border-primary/20 text-[10px] px-1.5 py-0">
                <Zap className="w-2.5 h-2.5 mr-0.5" />
                Powered by GPT-5
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Personalized coaching — ask to update your plan
            </p>
          </div>
        </div>
        {!isEmpty && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            className="cursor-pointer gap-1.5 text-muted-foreground"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            New chat
          </Button>
        )}
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-5">
        {historyLoading ? (
          <div className="flex-1 flex items-center justify-center py-12">
            <Spinner className="w-6 h-6 text-muted-foreground" />
          </div>
        ) : isEmpty ? (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="flex flex-col items-center justify-center h-full text-center space-y-6 max-w-lg mx-auto"
          >
            {/* Hero icon */}
            <div className="relative">
              <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center">
                <Sparkles className="w-10 h-10 text-primary" />
              </div>
              <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
                <div className="w-2 h-2 bg-white rounded-full" />
              </div>
            </div>

            <div>
              <h2 className="text-2xl font-bold mb-2">Your AI Coach is Ready</h2>
              <p className="text-muted-foreground text-sm leading-relaxed">
                I have access to your active program, workouts, nutrition data, and
                AI-generated plan. Ask me anything — or request changes to your plan
                and I'll present them for your approval.
              </p>
            </div>

            {/* Suggested prompts */}
            <div className="w-full space-y-2">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                Try asking
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => void sendMessage(prompt)}
                    className="text-left text-sm px-3 py-2.5 bg-card border border-border rounded-xl hover:border-primary/50 hover:bg-primary/5 transition-all cursor-pointer text-muted-foreground hover:text-foreground"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        ) : (
          <div className="max-w-2xl mx-auto w-full space-y-5">
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                onApproveProposal={handleApproveProposal}
                onRejectProposal={handleRejectProposal}
              />
            ))}
            <AnimatePresence>
              {isThinking && <TypingIndicator />}
            </AnimatePresence>
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-border bg-card/30 px-4 py-3 shrink-0">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-end gap-2 bg-card border border-border rounded-2xl px-3 py-2 focus-within:border-primary/50 transition-colors">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask your AI coach anything..."
              rows={1}
              className="flex-1 border-0 bg-transparent shadow-none resize-none focus-visible:ring-0 p-0 text-sm min-h-[24px] max-h-[120px]"
              style={{ fieldSizing: "content" } as React.CSSProperties}
              disabled={isThinking}
            />
            <Button
              size="sm"
              onClick={() => void sendMessage(input)}
              disabled={!input.trim() || isThinking}
              className="rounded-xl h-8 w-8 p-0 shrink-0 cursor-pointer"
            >
              {isThinking ? (
                <Spinner className="w-3.5 h-3.5" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground text-center mt-1.5">
            Press Enter to send · Shift+Enter for new line
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AiCoachPage() {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <AuthLoading>
        <div className="flex-1 flex items-center justify-center">
          <div className="space-y-4 text-center">
            <Skeleton className="h-20 w-20 rounded-2xl mx-auto" />
            <Skeleton className="h-6 w-48 mx-auto" />
            <Skeleton className="h-4 w-64 mx-auto" />
          </div>
        </div>
      </AuthLoading>

      <Unauthenticated>
        <div className="flex-1 flex flex-col items-center justify-center text-center space-y-4 p-8">
          <Sparkles className="w-16 h-16 text-primary" />
          <h2 className="text-3xl font-bold">Sign in to chat with your AI Coach</h2>
          <p className="text-muted-foreground">
            Get personalized fitness coaching powered by your real data.
          </p>
          <SignInButton />
        </div>
      </Unauthenticated>

      <Authenticated>
        <AiCoachChat />
      </Authenticated>
    </div>
  );
}
