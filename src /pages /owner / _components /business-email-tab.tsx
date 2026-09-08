/**
 * Business Email Inbox — full Mailgun-powered UI for owner/admin dashboard.
 * Folders: Inbox | Sent | Drafts | Archived | Deleted
 * Features: compose, reply, forward, search, categories, thread view, read/unread
 * Inbound emails arrive via Mailgun webhook → stored in Inbox folder.
 */

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.js";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog.tsx";
import {
  Send,
  FileText,
  Archive,
  Trash2,
  Search,
  X,
  Reply,
  Forward,
  RotateCcw,
  Mail,
  MailOpen,
  Tag,
  AlertCircle,
  CheckCircle2,
  Clock,
  Info,
  PenSquare,
  Inbox,
  ArrowDown,
} from "lucide-react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

type Folder = "inbox" | "sent" | "draft" | "archived" | "deleted";
type Category =
  | "general"
  | "partnerships"
  | "sponsors"
  | "vendors"
  | "app_store"
  | "legal";

type Email = {
  _id: string;
  folder: string;
  category: string;
  toAddresses: string[];
  ccAddresses?: string[];
  subject: string;
  body: string;
  isRead: boolean;
  isInbound?: boolean;
  fromAddress?: string;
  fromName?: string;
  sentAt?: string;
  createdAt: string;
  updatedAt: string;
  parentEmailId?: string;
  threadId?: string;
  _creationTime: number;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const FOLDERS: { key: Folder; label: string; icon: React.ReactNode }[] = [
  { key: "inbox", label: "Inbox", icon: <Inbox className="w-4 h-4" /> },
  { key: "sent", label: "Sent", icon: <Send className="w-4 h-4" /> },
  { key: "draft", label: "Drafts", icon: <FileText className="w-4 h-4" /> },
  { key: "archived", label: "Archived", icon: <Archive className="w-4 h-4" /> },
  { key: "deleted", label: "Deleted", icon: <Trash2 className="w-4 h-4" /> },
];

const CATEGORIES: { key: Category; label: string; color: string }[] = [
  { key: "general", label: "General Business", color: "bg-blue-500/20 text-blue-300 border-blue-500/30" },
  { key: "partnerships", label: "Partnerships", color: "bg-purple-500/20 text-purple-300 border-purple-500/30" },
  { key: "sponsors", label: "Sponsors", color: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30" },
  { key: "vendors", label: "Vendors", color: "bg-orange-500/20 text-orange-300 border-orange-500/30" },
  { key: "app_store", label: "App Store", color: "bg-green-500/20 text-green-300 border-green-500/30" },
  { key: "legal", label: "Legal / Admin", color: "bg-red-500/20 text-red-300 border-red-500/30" },
];

function categoryStyle(cat: string) {
  return CATEGORIES.find((c) => c.key === cat)?.color ?? "bg-muted/20 text-muted-foreground";
}
function categoryLabel(cat: string) {
  return CATEGORIES.find((c) => c.key === cat)?.label ?? cat;
}
function fmtDate(iso: string) {
  try { return format(parseISO(iso), "MMM d, h:mm a"); } catch { return iso; }
}

// ─── Compose Dialog ───────────────────────────────────────────────────────────

type ComposeMode = "new" | "reply" | "forward";
type ComposeState = {
  mode: ComposeMode;
  draftId?: Id<"businessEmails">;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  category: Category;
  parentEmailId?: Id<"businessEmails">;
  threadId?: Id<"businessEmails">;
};

function buildCompose(mode: ComposeMode = "new", source?: Email): ComposeState {
  if (mode === "reply" && source) {
    // Reply-to: if inbound, reply to sender; if outbound, reply to recipients
    const replyTo = source.isInbound
      ? (source.fromAddress ?? source.toAddresses.join(", "))
      : source.toAddresses.join(", ");
    return {
      mode,
      to: replyTo,
      cc: "",
      bcc: "",
      subject: source.subject.startsWith("Re:") ? source.subject : `Re: ${source.subject}`,
      body: `\n\n--- On ${fmtDate(source.sentAt ?? source.createdAt)}, ${source.isInbound ? (source.fromName ?? source.fromAddress ?? "sender") : "you"} wrote ---\n${source.body}`,
      category: source.category as Category,
      parentEmailId: source._id as Id<"businessEmails">,
      threadId: (source.threadId ?? source._id) as Id<"businessEmails">,
    };
  }
  if (mode === "forward" && source) {
    return {
      mode,
      to: "",
      cc: "",
      bcc: "",
      subject: source.subject.startsWith("Fwd:") ? source.subject : `Fwd: ${source.subject}`,
      body: `\n\n--- Forwarded message ---\nFrom: ${source.isInbound ? (source.fromAddress ?? "?") : "admin@agoatwalk.com"}\nTo: ${source.toAddresses.join(", ")}\nSubject: ${source.subject}\n\n${source.body}`,
      category: source.category as Category,
    };
  }
  return { mode: "new", to: "", cc: "", bcc: "", subject: "", body: "", category: "general" };
}

function ComposeDialog({
  open, onClose, initial, onSent,
}: {
  open: boolean;
  onClose: () => void;
  initial: ComposeState;
  onSent: () => void;
}) {
  const [s, setS] = useState<ComposeState>(initial);
  const [showCc, setShowCc] = useState(!!initial.cc);
  const [showBcc, setShowBcc] = useState(!!initial.bcc);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [autoTimer, setAutoTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  const saveDraftMut = useMutation(api.businessEmails.saveDraft);
  const sendEmailMut = useMutation(api.businessEmails.sendEmail);

  useEffect(() => {
    if (open) { setS(initial); setShowCc(!!initial.cc); setShowBcc(!!initial.bcc); }
  }, [open, initial]);

  function parseAddrs(str: string) {
    return str.split(/[\s,;]+/).map((a) => a.trim()).filter(Boolean);
  }

  function upd(patch: Partial<ComposeState>) {
    const next = { ...s, ...patch };
    setS(next);
    if (autoTimer) clearTimeout(autoTimer);
    const t = setTimeout(() => doAutoSave(next), 3000);
    setAutoTimer(t);
  }

  async function doAutoSave(st: ComposeState) {
    if (!st.subject && !st.body && !st.to) return;
    setSaving(true);
    try {
      const id = await saveDraftMut({
        id: st.draftId,
        toAddresses: parseAddrs(st.to),
        ccAddresses: parseAddrs(st.cc),
        bccAddresses: parseAddrs(st.bcc),
        subject: st.subject,
        body: st.body,
        category: st.category,
        parentEmailId: st.parentEmailId,
        threadId: st.threadId,
      });
      setS((prev) => ({ ...prev, draftId: id as Id<"businessEmails"> }));
    } catch { /* silent */ } finally { setSaving(false); }
  }

  async function handleSend() {
    if (!s.to.trim()) { toast.error("Add at least one recipient"); return; }
    if (!s.subject.trim()) { toast.error("Subject is required"); return; }
    if (!s.body.trim()) { toast.error("Email body is required"); return; }
    setSending(true);
    try {
      if (autoTimer) clearTimeout(autoTimer);
      await sendEmailMut({
        draftId: s.draftId,
        toAddresses: parseAddrs(s.to),
        ccAddresses: parseAddrs(s.cc),
        bccAddresses: parseAddrs(s.bcc),
        subject: s.subject,
        body: s.body,
        category: s.category,
        parentEmailId: s.parentEmailId,
        threadId: s.threadId,
      });
      toast.success("Email sent via Mailgun from admin@agoatwalk.com");
      onSent();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send");
    } finally { setSending(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-[#111] border-[#222]">
        <DialogHeader>
          <DialogTitle className="text-white font-rajdhani text-xl tracking-wide">
            {s.mode === "reply" ? "Reply" : s.mode === "forward" ? "Forward" : "Compose Email"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          {/* From */}
          <div className="flex items-center gap-2 px-3 py-2 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg">
            <span className="text-xs text-muted-foreground w-8 shrink-0">From</span>
            <span className="text-sm text-[#4169E1] font-medium">admin@agoatwalk.com</span>
          </div>
          {/* To */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-8 shrink-0">To</span>
            <Input value={s.to} onChange={(e) => upd({ to: e.target.value })}
              placeholder="recipient@example.com" className="flex-1 bg-[#1a1a1a] border-[#2a2a2a] text-sm" />
            <div className="flex gap-1 shrink-0">
              {!showCc && <button onClick={() => setShowCc(true)} className="text-xs text-muted-foreground hover:text-white cursor-pointer px-1">Cc</button>}
              {!showBcc && <button onClick={() => setShowBcc(true)} className="text-xs text-muted-foreground hover:text-white cursor-pointer px-1">Bcc</button>}
            </div>
          </div>
          {showCc && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-8 shrink-0">Cc</span>
              <Input value={s.cc} onChange={(e) => upd({ cc: e.target.value })}
                placeholder="cc@example.com" className="flex-1 bg-[#1a1a1a] border-[#2a2a2a] text-sm" />
            </div>
          )}
          {showBcc && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-8 shrink-0">Bcc</span>
              <Input value={s.bcc} onChange={(e) => upd({ bcc: e.target.value })}
                placeholder="bcc@example.com" className="flex-1 bg-[#1a1a1a] border-[#2a2a2a] text-sm" />
            </div>
          )}
          {/* Subject */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-8 shrink-0">Re</span>
            <Input value={s.subject} onChange={(e) => upd({ subject: e.target.value })}
              placeholder="Subject" className="flex-1 bg-[#1a1a1a] border-[#2a2a2a] text-sm" />
          </div>
          {/* Category */}
          <div className="flex items-center gap-2">
            <Tag className="w-3 h-3 text-muted-foreground shrink-0" />
            <Select value={s.category} onValueChange={(v) => upd({ category: v as Category })}>
              <SelectTrigger className="flex-1 bg-[#1a1a1a] border-[#2a2a2a] text-sm h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {/* Body */}
          <Textarea value={s.body} onChange={(e) => upd({ body: e.target.value })}
            placeholder="Write your message..." className="min-h-[200px] bg-[#1a1a1a] border-[#2a2a2a] text-sm resize-none" />
          {/* Footer */}
          <div className="flex items-center justify-between gap-2 pt-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {saving && <><Clock className="w-3 h-3" /> Saving...</>}
              {!saving && s.draftId && <span className="text-green-500 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Draft saved</span>}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => doAutoSave(s)} disabled={saving} className="cursor-pointer">Save Draft</Button>
              <Button size="sm" onClick={handleSend} disabled={sending}
                className="bg-[#4169E1] hover:bg-[#3358c4] text-white cursor-pointer gap-2">
                <Send className="w-3.5 h-3.5" />{sending ? "Sending..." : "Send"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Email Row ────────────────────────────────────────────────────────────────

function EmailRow({ email, onOpen }: { email: Email; onOpen: (e: Email) => void }) {
  const isInbound = email.isInbound;
  const sender = isInbound
    ? (email.fromName ?? email.fromAddress ?? "Unknown")
    : `To: ${email.toAddresses.join(", ")}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "flex items-start gap-3 px-4 py-3 border-b border-[#1a1a1a] cursor-pointer transition-colors hover:bg-[#161616]",
        !email.isRead && "bg-[#0d0d18]",
      )}
      onClick={() => onOpen(email)}
    >
      <div className="mt-0.5 shrink-0">
        {isInbound
          ? (!email.isRead ? <ArrowDown className="w-4 h-4 text-[#4169E1]" /> : <MailOpen className="w-4 h-4 text-muted-foreground" />)
          : <Send className="w-4 h-4 text-muted-foreground/50" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className={cn("text-sm font-medium truncate", !email.isRead && "text-white font-semibold")}>
            {email.subject || "(no subject)"}
          </span>
          <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 shrink-0 border", categoryStyle(email.category))}>
            {categoryLabel(email.category)}
          </Badge>
          {isInbound && !email.isRead && (
            <span className="w-2 h-2 rounded-full bg-[#4169E1] shrink-0" />
          )}
        </div>
        <div className="text-xs text-muted-foreground truncate">{sender}</div>
        <div className="text-xs text-muted-foreground/60 truncate mt-0.5">
          {email.body.slice(0, 100).replace(/\n/g, " ")}
        </div>
      </div>
      <div className="shrink-0 text-[11px] text-muted-foreground whitespace-nowrap">
        {fmtDate(email.sentAt ?? email.createdAt)}
      </div>
    </motion.div>
  );
}

// ─── Email Detail ─────────────────────────────────────────────────────────────

function EmailDetail({
  email, onClose, onReply, onForward, onArchive, onDelete, onMoveToFolder,
}: {
  email: Email;
  onClose: () => void;
  onReply: () => void;
  onForward: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onMoveToFolder: (folder: Folder) => void;
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-start justify-between gap-4 p-4 border-b border-[#2a2a2a]">
        <div className="flex-1 min-w-0">
          <h3 className="text-white font-semibold text-base mb-1">{email.subject || "(no subject)"}</h3>
          {email.isInbound ? (
            <div className="text-xs text-muted-foreground">
              From: <span className="text-white">{email.fromName ?? ""} {email.fromAddress ? `<${email.fromAddress}>` : ""}</span>
              {email.ccAddresses && email.ccAddresses.length > 0 && <span> · Cc: {email.ccAddresses.join(", ")}</span>}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">
              To: <span className="text-white">{email.toAddresses.join(", ")}</span>
              {email.ccAddresses && email.ccAddresses.length > 0 && <span> · Cc: {email.ccAddresses.join(", ")}</span>}
            </div>
          )}
          <div className="flex items-center gap-2 mt-1">
            {email.isInbound && (
              <Badge className="bg-[#4169E1]/20 text-[#4169E1] border border-[#4169E1]/30 text-[10px] px-1.5 py-0">
                Received
              </Badge>
            )}
            <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 border", categoryStyle(email.category))}>
              {categoryLabel(email.category)}
            </Badge>
            <span className="text-[11px] text-muted-foreground">
              {fmtDate(email.sentAt ?? email.createdAt)}
            </span>
          </div>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-white cursor-pointer mt-1">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <pre className="text-sm text-[#ccc] whitespace-pre-wrap font-sans leading-relaxed">{email.body}</pre>
      </div>
      <div className="flex items-center gap-2 p-4 border-t border-[#2a2a2a] flex-wrap">
        <Button size="sm" onClick={onReply} className="bg-[#4169E1] hover:bg-[#3358c4] text-white cursor-pointer gap-1.5">
          <Reply className="w-3.5 h-3.5" /> Reply
        </Button>
        <Button size="sm" variant="ghost" onClick={onForward} className="cursor-pointer gap-1.5">
          <Forward className="w-3.5 h-3.5" /> Forward
        </Button>
        {email.folder !== "archived" && (
          <Button size="sm" variant="ghost" onClick={onArchive} className="cursor-pointer gap-1.5">
            <Archive className="w-3.5 h-3.5" /> Archive
          </Button>
        )}
        {email.folder === "archived" && (
          <Button size="sm" variant="ghost" onClick={() => onMoveToFolder("inbox")} className="cursor-pointer gap-1.5">
            <RotateCcw className="w-3.5 h-3.5" /> Restore to Inbox
          </Button>
        )}
        {email.folder !== "deleted" ? (
          <Button size="sm" variant="ghost" onClick={onDelete} className="cursor-pointer gap-1.5 text-destructive hover:text-destructive">
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => onMoveToFolder("inbox")} className="cursor-pointer gap-1.5">
            <RotateCcw className="w-3.5 h-3.5" /> Restore
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function BusinessEmailTab() {
  const [activeFolder, setActiveFolder] = useState<Folder>("inbox");
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeInitial, setComposeInitial] = useState<ComposeState>(() => buildCompose());
  const [deleteConfirmEmail, setDeleteConfirmEmail] = useState<Email | null>(null);

  const emails = useQuery(api.businessEmails.listByFolder, isSearching ? "skip" : { folder: activeFolder });
  const searchResults = useQuery(api.businessEmails.search, isSearching && searchQuery.trim() ? { q: searchQuery } : "skip");
  const draftCount = useQuery(api.businessEmails.countDrafts, {});
  const unreadInbox = useQuery(api.businessEmails.countUnreadInbox, {});

  const markReadMut = useMutation(api.businessEmails.markRead);
  const moveToFolderMut = useMutation(api.businessEmails.moveToFolder);
  const permanentlyDeleteMut = useMutation(api.businessEmails.permanentlyDelete);

  const displayEmails: Email[] = ((isSearching ? searchResults : emails) as Email[] | undefined) ?? [];

  function openCompose(mode: ComposeMode = "new", source?: Email) {
    setComposeInitial(buildCompose(mode, source));
    setComposeOpen(true);
  }

  async function openEmail(email: Email) {
    setSelectedEmail(email);
    if (!email.isRead) {
      await markReadMut({ id: email._id as Id<"businessEmails">, isRead: true }).catch(() => {});
    }
  }

  async function handleArchive(email: Email) {
    await moveToFolderMut({ id: email._id as Id<"businessEmails">, folder: "archived" });
    if (selectedEmail?._id === email._id) setSelectedEmail(null);
    toast.success("Archived");
  }

  async function handleDelete(email: Email) {
    if (email.folder === "deleted") { setDeleteConfirmEmail(email); return; }
    await moveToFolderMut({ id: email._id as Id<"businessEmails">, folder: "deleted" });
    if (selectedEmail?._id === email._id) setSelectedEmail(null);
    toast.success("Moved to Deleted");
  }

  async function handleMoveToFolder(email: Email, folder: Folder) {
    await moveToFolderMut({ id: email._id as Id<"businessEmails">, folder });
    if (selectedEmail?._id === email._id) setSelectedEmail(null);
    toast.success(`Moved to ${folder}`);
  }

  async function handlePermanentDelete(email: Email) {
    await permanentlyDeleteMut({ id: email._id as Id<"businessEmails"> });
    setSelectedEmail(null);
    setDeleteConfirmEmail(null);
    toast.success("Permanently deleted");
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="p-4 bg-[#0f0f18] border border-[#4169E1]/20 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-rajdhani text-lg font-semibold text-white tracking-wide flex items-center gap-2">
            <Mail className="w-5 h-5 text-[#4169E1]" />
            Business Email
            {(unreadInbox ?? 0) > 0 && (
              <Badge className="bg-[#4169E1] text-white text-xs px-2">{unreadInbox} new</Badge>
            )}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Powered by Mailgun · <span className="text-[#4169E1] font-medium">admin@agoatwalk.com</span>
          </p>
        </div>
        <Button onClick={() => openCompose("new")}
          className="bg-[#4169E1] hover:bg-[#3358c4] text-white cursor-pointer gap-2 self-start sm:self-auto">
          <PenSquare className="w-4 h-4" /> Compose
        </Button>
      </div>

      {/* Mailgun setup instructions */}
      <div className="p-4 bg-[#111] border border-[#2a2a2a] rounded-xl space-y-3">
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 text-[#4169E1] shrink-0" />
          <span className="text-sm font-medium text-white">Mailgun Setup Required</span>
        </div>
        <div className="grid gap-2 text-xs text-muted-foreground pl-6">
          <div className="flex gap-2">
            <span className="text-[#4169E1] font-bold shrink-0">1.</span>
            <span>Add secrets in Hercules <strong className="text-white">Advanced → Secrets</strong>: <code className="bg-[#1a1a1a] px-1 py-0.5 rounded text-white">MAILGUN_API_KEY</code>, <code className="bg-[#1a1a1a] px-1 py-0.5 rounded text-white">MAILGUN_DOMAIN</code> (e.g. <em>mg.agoatwalk.com</em>), <code className="bg-[#1a1a1a] px-1 py-0.5 rounded text-white">MAILGUN_WEBHOOK_SIGNING_KEY</code></span>
          </div>
          <div className="flex gap-2">
            <span className="text-[#4169E1] font-bold shrink-0">2.</span>
            <span>In <strong className="text-white">Mailgun → Domains</strong>, add your domain and add the DNS records (MX, SPF, DKIM) to your registrar. This enables sending <em>and</em> receiving at <strong className="text-white">admin@agoatwalk.com</strong>.</span>
          </div>
          <div className="flex gap-2">
            <span className="text-[#4169E1] font-bold shrink-0">3.</span>
            <span>In <strong className="text-white">Mailgun → Receiving → Routes</strong>, create a route: match <code className="bg-[#1a1a1a] px-1 py-0.5 rounded text-white">admin@agoatwalk.com</code> → forward to your Convex HTTP Actions URL: <code className="bg-[#1a1a1a] px-1 py-0.5 rounded text-white">[your-deployment].convex.site/mailgun-inbound</code>. Find this URL in <strong className="text-white">More → Backend → HTTP Actions URL</strong>.</span>
          </div>
        </div>
        <div className="flex items-center gap-2 pt-1 pl-6">
          <AlertCircle className="w-3 h-3 text-yellow-500 shrink-0" />
          <span className="text-xs text-yellow-500/80">Until Mailgun is configured, outbound emails will fail and the Inbox will stay empty.</span>
        </div>
      </div>

      <div className="flex gap-3 flex-col lg:flex-row">
        {/* Sidebar */}
        <div className="w-full lg:w-52 shrink-0 space-y-1">
          {FOLDERS.map((f) => (
            <button
              key={f.key}
              onClick={() => { setActiveFolder(f.key); setIsSearching(false); setSelectedEmail(null); setSearchQuery(""); }}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm cursor-pointer transition-colors text-left",
                activeFolder === f.key && !isSearching
                  ? "bg-[#4169E1]/20 text-[#4169E1] font-medium"
                  : "text-muted-foreground hover:bg-[#1a1a1a] hover:text-white",
              )}
            >
              {f.icon}
              {f.label}
              {f.key === "inbox" && (unreadInbox ?? 0) > 0 && (
                <Badge className="ml-auto bg-[#4169E1] text-white text-[10px] px-1.5 py-0 h-4">{unreadInbox}</Badge>
              )}
              {f.key === "draft" && (draftCount ?? 0) > 0 && (
                <Badge className="ml-auto bg-muted text-muted-foreground text-[10px] px-1.5 py-0 h-4">{draftCount}</Badge>
              )}
            </button>
          ))}

          <div className="pt-2 border-t border-[#1a1a1a]">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground/50 px-3 pb-1">Categories</p>
            {CATEGORIES.map((c) => (
              <div key={c.key} className={cn("flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs", categoryStyle(c.key))}>
                <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" />
                {c.label}
              </div>
            ))}
          </div>
        </div>

        {/* Email list + detail */}
        <div className="flex-1 min-w-0 flex flex-col border border-[#2a2a2a] rounded-xl overflow-hidden">
          {/* Search */}
          <div className="p-3 border-b border-[#2a2a2a] flex items-center gap-2 bg-[#0d0d0d]">
            <Search className="w-4 h-4 text-muted-foreground shrink-0" />
            <Input
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setIsSearching(!!e.target.value.trim()); }}
              placeholder="Search emails..."
              className="border-0 bg-transparent text-sm p-0 h-auto focus-visible:ring-0 placeholder:text-muted-foreground/50"
            />
            {isSearching && (
              <button onClick={() => { setSearchQuery(""); setIsSearching(false); }} className="text-muted-foreground hover:text-white cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex flex-1 min-h-[400px]">
            {/* List */}
            <div className={cn("flex flex-col border-r border-[#2a2a2a] overflow-y-auto", selectedEmail ? "hidden lg:flex lg:w-80 shrink-0" : "flex-1")}>
              {emails === undefined && !isSearching ? (
                <div className="p-4 space-y-3">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
                </div>
              ) : displayEmails.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
                  {activeFolder === "inbox" ? <Inbox className="w-8 h-8 opacity-30" /> : <Mail className="w-8 h-8 opacity-30" />}
                  <p className="text-sm">{isSearching ? "No results" : activeFolder === "inbox" ? "Inbox is empty" : `No emails in ${activeFolder}`}</p>
                  {activeFolder === "inbox" && (
                    <p className="text-xs text-muted-foreground/50 text-center max-w-[200px]">Emails sent to admin@agoatwalk.com will appear here once Mailgun is configured</p>
                  )}
                </div>
              ) : (
                displayEmails.map((email) => (
                  <EmailRow key={email._id} email={email} onOpen={openEmail} />
                ))
              )}
            </div>

            {/* Detail */}
            {selectedEmail && (
              <div className="flex-1 min-w-0 bg-[#0d0d0d]">
                <EmailDetail
                  email={selectedEmail}
                  onClose={() => setSelectedEmail(null)}
                  onReply={() => openCompose("reply", selectedEmail)}
                  onForward={() => openCompose("forward", selectedEmail)}
                  onArchive={() => handleArchive(selectedEmail)}
                  onDelete={() => handleDelete(selectedEmail)}
                  onMoveToFolder={(folder) => handleMoveToFolder(selectedEmail, folder)}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Compose dialog */}
      <ComposeDialog
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        initial={composeInitial}
        onSent={() => { setActiveFolder("sent"); setIsSearching(false); }}
      />

      {/* Permanent delete confirmation */}
      <AlertDialog open={!!deleteConfirmEmail} onOpenChange={(o) => !o && setDeleteConfirmEmail(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer">Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive hover:bg-destructive/90 cursor-pointer"
              onClick={() => deleteConfirmEmail && handlePermanentDelete(deleteConfirmEmail)}>
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
