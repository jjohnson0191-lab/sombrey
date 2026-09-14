import { useState, useRef, useEffect } from "react";
import { Authenticated, useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.js";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty.tsx";
import { MessageSquare, Send, ArrowLeft, Search, Plus } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import { format, isToday, isYesterday } from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTime(ts: number) {
  const d = new Date(ts);
  if (isToday(d)) return format(d, "h:mm a");
  if (isYesterday(d)) return "Yesterday";
  return format(d, "MMM d");
}

function roleLabel(role: string) {
  if (role === "coach") return "Coach";
  if (role === "admin") return "Admin";
  return "Client";
}

// ─── New Conversation Dialog ──────────────────────────────────────────────────

function NewConversationPanel({
  onSelect,
  existingPartnerIds,
}: {
  onSelect: (id: Id<"users">) => void;
  existingPartnerIds: Id<"users">[];
}) {
  const messageableUsers = useQuery(api.messages.getMessageableUsers, {});
  const [search, setSearch] = useState("");

  if (messageableUsers === undefined) return <Skeleton className="h-32 w-full" />;

  const available = messageableUsers.filter(
    (u) =>
      !existingPartnerIds.includes(u._id) &&
      u.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-4 space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>
      {available.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">No users available to message</p>
      ) : (
        <div className="space-y-1">
          {available.map((u) => (
            <button
              key={u._id}
              onClick={() => onSelect(u._id)}
              className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-muted/60 transition-colors cursor-pointer text-left"
            >
              <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                <span className="text-sm font-bold text-primary">
                  {(u.name[0] ?? "?").toUpperCase()}
                </span>
              </div>
              <div>
                <p className="font-medium text-sm">{u.name}</p>
                <p className="text-xs text-muted-foreground">{roleLabel(u.role)}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Conversation List ────────────────────────────────────────────────────────

function ConversationList({
  activePartnerId,
  onSelect,
  onNew,
}: {
  activePartnerId: Id<"users"> | null;
  onSelect: (id: Id<"users">) => void;
  onNew: () => void;
}) {
  const conversations = useQuery(api.messages.listConversations, {});
  const [search, setSearch] = useState("");
  const [showNew, setShowNew] = useState(false);

  if (conversations === undefined) {
    return (
      <div className="p-4 space-y-3">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
      </div>
    );
  }

  const filtered = conversations.filter((c) =>
    c.partnerName.toLowerCase().includes(search.toLowerCase())
  );

  const existingIds = conversations.map((c) => c.partnerId);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-border space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-lg">Messages</h2>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => { setShowNew(!showNew); onNew(); }}
            className="cursor-pointer"
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search conversations..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
      </div>

      {showNew && (
        <div className="border-b border-border bg-muted/20">
          <p className="text-xs font-semibold text-muted-foreground px-4 pt-3 pb-1 uppercase tracking-wide">
            Start new conversation
          </p>
          <NewConversationPanel
            onSelect={(id) => { setShowNew(false); onSelect(id); }}
            existingPartnerIds={existingIds}
          />
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 && !showNew ? (
          <div className="p-6">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon"><MessageSquare /></EmptyMedia>
                <EmptyTitle>No conversations yet</EmptyTitle>
                <EmptyDescription>Start a new conversation with the + button above</EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        ) : (
          <div className="py-2">
            {filtered.map((c) => (
              <button
                key={c.partnerId}
                onClick={() => onSelect(c.partnerId)}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors cursor-pointer text-left",
                  activePartnerId === c.partnerId && "bg-muted/60"
                )}
              >
                {/* Avatar */}
                <div className="relative shrink-0">
                  <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                    <span className="text-sm font-bold text-primary">
                      {(c.partnerName[0] ?? "?").toUpperCase()}
                    </span>
                  </div>
                  {c.unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-primary text-[10px] font-bold text-primary-foreground flex items-center justify-center">
                      {c.unreadCount > 9 ? "9+" : c.unreadCount}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm truncate">{c.partnerName}</span>
                    <span className="text-xs text-muted-foreground shrink-0 ml-2">
                      {c.lastMessageTime ? formatTime(c.lastMessageTime) : ""}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground truncate">{c.lastMessage || "No messages yet"}</p>
                    <Badge variant="secondary" className="text-[10px] shrink-0">{roleLabel(c.partnerRole)}</Badge>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Chat Window ──────────────────────────────────────────────────────────────

function ChatWindow({
  partnerId,
  onBack,
}: {
  partnerId: Id<"users">;
  onBack: () => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const messages = useQuery(api.messages.getConversation, { partnerId });
  const partner = useQuery(api.messages.getUserById, { userId: partnerId });
  const currentUser = useQuery(api.users.getCurrentUser, {});
  const sendMessage = useMutation(api.messages.send);
  const markRead = useMutation(api.messages.markRead);

  // Mark as read when opened
  useEffect(() => {
    if (partnerId) {
      markRead({ partnerId }).catch(() => {});
    }
  }, [partnerId, markRead]);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    const content = text.trim();
    if (!content) return;
    setSending(true);
    try {
      await sendMessage({ recipientId: partnerId, content });
      setText("");
    } catch {
      toast.error("Failed to send message");
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  if (messages === undefined || partner === undefined || currentUser === undefined) {
    return (
      <div className="flex-1 flex flex-col p-6 space-y-4">
        <Skeleton className="h-10 w-48" />
        <div className="flex-1 space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className={`h-12 w-${i % 2 === 0 ? "2/3" : "1/2"}`} />)}
        </div>
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  // Group messages by date
  const grouped: { date: string; msgs: typeof messages }[] = [];
  for (const msg of messages) {
    const dateKey = format(new Date(msg._creationTime), "yyyy-MM-dd");
    const last = grouped[grouped.length - 1];
    if (last && last.date === dateKey) {
      last.msgs.push(msg);
    } else {
      grouped.push({ date: dateKey, msgs: [msg] });
    }
  }

  const formatDateLabel = (dateStr: string) => {
    const d = new Date(dateStr + "T12:00:00");
    if (isToday(d)) return "Today";
    if (isYesterday(d)) return "Yesterday";
    return format(d, "MMMM d, yyyy");
  };

  return (
    <div className="flex-1 flex flex-col h-full min-h-0">
      {/* Chat header */}
      <div className="px-4 py-3 border-b border-border bg-card/50 flex items-center gap-3 shrink-0">
        <Button variant="ghost" size="sm" onClick={onBack} className="md:hidden cursor-pointer p-1">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
          <span className="text-sm font-bold text-primary">
            {(partner?.name?.[0] ?? "?").toUpperCase()}
          </span>
        </div>
        <div>
          <p className="font-semibold text-sm">{partner?.name ?? "User"}</p>
          <p className="text-xs text-muted-foreground">{roleLabel(partner?.role ?? "client")}</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-muted-foreground">
              <MessageSquare className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Start a conversation with {partner?.name ?? "this user"}</p>
            </div>
          </div>
        ) : (
          grouped.map(({ date, msgs }) => (
            <div key={date}>
              <div className="flex items-center gap-3 my-3">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted-foreground">{formatDateLabel(date)}</span>
                <div className="flex-1 h-px bg-border" />
              </div>
              <div className="space-y-2">
                {msgs.map((msg, i) => {
                  const isMe = msg.senderId === currentUser?._id;
                  const prevMsg = msgs[i - 1];
                  const showAvatar = !isMe && (!prevMsg || prevMsg.senderId !== msg.senderId);

                  return (
                    <motion.div
                      key={msg._id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2 }}
                      className={cn("flex items-end gap-2", isMe ? "justify-end" : "justify-start")}
                    >
                      {!isMe && (
                        <div className={cn("w-7 h-7 rounded-full shrink-0 flex items-center justify-center bg-primary/20", !showAvatar && "invisible")}>
                          <span className="text-xs font-bold text-primary">
                            {(partner?.name?.[0] ?? "?").toUpperCase()}
                          </span>
                        </div>
                      )}
                      <div className={cn("max-w-[70%] space-y-1", isMe && "items-end flex flex-col")}>
                        <div
                          className={cn(
                            "px-3 py-2 rounded-2xl text-sm leading-relaxed",
                            isMe
                              ? "bg-primary text-primary-foreground rounded-br-sm"
                              : "bg-muted text-foreground rounded-bl-sm"
                          )}
                        >
                          {msg.content}
                        </div>
                        <span className="text-[10px] text-muted-foreground px-1">
                          {format(new Date(msg._creationTime), "h:mm a")}
                          {isMe && (
                            <span className="ml-1">{msg.read ? "· Read" : ""}</span>
                          )}
                        </span>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-border bg-card/50 shrink-0">
        <div className="flex items-center gap-2">
          <Input
            placeholder="Type a message..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={sending}
            className="flex-1"
          />
          <Button
            onClick={handleSend}
            disabled={!text.trim() || sending}
            size="sm"
            className="cursor-pointer shrink-0 h-9 w-9 p-0"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1 pl-1">Press Enter to send</p>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function MessagesContent() {
  const [searchParams, setSearchParams] = useSearchParams();
  const partnerIdParam = searchParams.get("with") as Id<"users"> | null;
  const [activePartnerId, setActivePartnerId] = useState<Id<"users"> | null>(partnerIdParam);
  const [showList, setShowList] = useState(!partnerIdParam);

  const selectPartner = (id: Id<"users">) => {
    setActivePartnerId(id);
    setSearchParams({ with: id });
    setShowList(false);
  };

  const goBack = () => {
    setShowList(true);
    setActivePartnerId(null);
    setSearchParams({});
  };

  return (
    <div className="flex h-[calc(100vh-65px)] overflow-hidden border border-border rounded-xl bg-card/30 backdrop-blur">
      {/* Sidebar (conversation list) */}
      <AnimatePresence initial={false}>
        <div
          className={cn(
            "border-r border-border bg-card/50 flex flex-col",
            // On mobile show list OR chat, on desktop show both
            showList ? "flex w-full md:w-80 md:flex" : "hidden md:flex md:w-80"
          )}
        >
          <ConversationList
            activePartnerId={activePartnerId}
            onSelect={selectPartner}
            onNew={() => {}}
          />
        </div>
      </AnimatePresence>

      {/* Chat area */}
      <div
        className={cn(
          "flex-1 flex flex-col min-w-0",
          showList && !activePartnerId ? "hidden md:flex" : "flex"
        )}
      >
        {activePartnerId ? (
          <ChatWindow partnerId={activePartnerId} onBack={goBack} />
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-muted-foreground space-y-2">
              <MessageSquare className="w-14 h-14 mx-auto opacity-20" />
              <p className="text-sm font-medium">Select a conversation to start messaging</p>
              <p className="text-xs opacity-60">Or start a new one with the + button</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function MessagesPage() {
  return (
    <Authenticated>
      <div className="px-4 py-4 flex-1 flex flex-col min-h-0">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="flex-1 flex flex-col min-h-0"
        >
          <div className="mb-4">
            <h1 className="text-3xl font-bold">
              Messages
            </h1>
            <p className="text-muted-foreground text-sm">Stay connected with your coach and clients</p>
          </div>
          <MessagesContent />
        </motion.div>
      </div>
    </Authenticated>
  );
}
