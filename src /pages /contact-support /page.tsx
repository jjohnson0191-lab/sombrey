import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import { toast } from "sonner";
import { ConvexError } from "convex/values";
import { MessageSquare, ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";

type Ticket = Doc<"supportTickets">;

const APP_VERSION = "1.0.0";

function getDeviceInfo(): string {
  const ua = navigator.userAgent;
  const browser = ua.includes("Chrome")
    ? "Chrome"
    : ua.includes("Firefox")
      ? "Firefox"
      : ua.includes("Safari")
        ? "Safari"
        : "Unknown Browser";
  const os = ua.includes("Mac")
    ? "macOS"
    : ua.includes("Win")
      ? "Windows"
      : ua.includes("Android")
        ? "Android"
        : ua.includes("iPhone") || ua.includes("iPad")
          ? "iOS"
          : "Unknown OS";
  return `${browser} / ${os}`;
}

const STATUS_BADGE: Record<Ticket["status"], { label: string; class: string }> = {
  open: { label: "Open", class: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  replied: { label: "Replied", class: "bg-green-500/15 text-green-400 border-green-500/30" },
  closed: { label: "Closed", class: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30" },
};

function TicketRow({ ticket }: { ticket: Ticket }) {
  const [expanded, setExpanded] = useState(false);
  const badge = STATUS_BADGE[ticket.status];
  return (
    <div className="border border-zinc-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-start gap-3 p-4 text-left hover:bg-white/5 transition-colors cursor-pointer"
      >
        <MessageSquare className="w-4 h-4 text-zinc-500 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-white truncate">{ticket.subject}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full border ${badge.class}`}>
              {badge.label}
            </span>
          </div>
          <p className="text-xs text-zinc-500 mt-0.5">
            {new Date(ticket.createdAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-zinc-600 shrink-0 mt-0.5" />
        ) : (
          <ChevronDown className="w-4 h-4 text-zinc-600 shrink-0 mt-0.5" />
        )}
      </button>
      {expanded && (
        <div className="px-4 pb-4 pt-0 space-y-3 border-t border-zinc-800">
          <div className="bg-zinc-900/60 rounded-lg p-3 mt-3">
            <p className="text-xs text-zinc-500 mb-1 uppercase tracking-wider">Your Message</p>
            <p className="text-sm text-zinc-300 whitespace-pre-wrap">{ticket.message}</p>
          </div>
          {ticket.replies.map((reply, i) => (
            <div key={i} className="bg-[#0d1a2e] border border-[#1e3a5f] border-l-2 border-l-[#4169E1] rounded-lg p-3">
              <p className="text-xs text-[#4169E1] mb-1 uppercase tracking-wider">
                Reply from {reply.adminName ?? "GOAT WALK Support"}
              </p>
              <p className="text-sm text-zinc-200 whitespace-pre-wrap">{reply.message}</p>
              <p className="text-xs text-zinc-600 mt-1">
                {new Date(reply.sentAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NewTicketDialog({
  open,
  onClose,
  userEmail,
  userId,
  subscriptionTier,
}: {
  open: boolean;
  onClose: () => void;
  userEmail: string;
  userId: string;
  subscriptionTier: string;
}) {
  const submit = useMutation(api.supportTickets.submitTicket);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!subject.trim() || !message.trim()) {
      toast.error("Please fill in all fields.");
      return;
    }
    setLoading(true);
    try {
      await submit({
        subject: subject.trim(),
        message: message.trim(),
        deviceInfo: getDeviceInfo(),
        appVersion: APP_VERSION,
      });
      toast.success("Support request submitted. We'll reply within 24–48 hours.");
      setSubject("");
      setMessage("");
      onClose();
    } catch (err) {
      const msg =
        err instanceof ConvexError
          ? (err.data as { message?: string })?.message ?? "Submission failed."
          : "Submission failed. Please try again.";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-[#111] border border-zinc-800 max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white">Contact Support</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Auto-populated context */}
          <div className="bg-zinc-900/60 rounded-lg p-3 text-xs text-zinc-500 space-y-1">
            <p><span className="text-zinc-600">Account:</span> {userEmail}</p>
            <p><span className="text-zinc-600">User ID:</span> {userId.slice(-12)}</p>
            <p><span className="text-zinc-600">Plan:</span> {subscriptionTier}</p>
            <p><span className="text-zinc-600">Device:</span> {getDeviceInfo()}</p>
            <p><span className="text-zinc-600">App Version:</span> {APP_VERSION}</p>
          </div>

          <div>
            <label className="block text-sm text-zinc-400 mb-1.5">Subject</label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. AI plan not loading"
              className="bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-600"
              maxLength={120}
            />
          </div>

          <div>
            <label className="block text-sm text-zinc-400 mb-1.5">Message</label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Describe your issue in detail..."
              className="bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-600 min-h-[120px] resize-none"
              maxLength={3000}
            />
            <p className="text-xs text-zinc-600 mt-1 text-right">{message.length}/3000</p>
          </div>

          <div className="flex gap-2 pt-1">
            <Button
              variant="ghost"
              onClick={onClose}
              disabled={loading}
              className="flex-1 border border-zinc-700 text-zinc-400 hover:text-white cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={loading || !subject.trim() || !message.trim()}
              className="flex-1 bg-[#4169E1] hover:bg-[#3055c8] text-white font-semibold cursor-pointer"
            >
              {loading ? "Sending..." : "Submit Request"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ContactSupportPage() {
  const currentUser = useQuery(api.users.getCurrentUser);
  const tickets = useQuery(api.supportTickets.getMyTickets);
  const [showDialog, setShowDialog] = useState(false);

  if (!currentUser) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <p className="text-xs text-[#4169E1] font-semibold tracking-widest uppercase mb-1">SUPPORT</p>
        <h1 className="text-3xl font-black text-white tracking-tight">Contact Support</h1>
        <p className="text-zinc-500 text-sm mt-1">
          We typically respond within 24–48 hours.
        </p>
      </div>

      {/* New ticket button */}
      <Button
        onClick={() => setShowDialog(true)}
        className="w-full bg-[#4169E1] hover:bg-[#3055c8] text-white font-semibold mb-8 cursor-pointer"
      >
        <Plus className="w-4 h-4 mr-2" />
        New Support Request
      </Button>

      {/* Ticket history */}
      <div>
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
          Your Tickets
        </h2>
        {tickets === undefined ? (
          <div className="space-y-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : tickets.length === 0 ? (
          <div className="border border-zinc-800 rounded-xl p-8 text-center">
            <MessageSquare className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
            <p className="text-zinc-500 text-sm">No support tickets yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {tickets.map((t) => (
              <TicketRow key={t._id} ticket={t} />
            ))}
          </div>
        )}
      </div>

      {showDialog && currentUser.email && (
        <NewTicketDialog
          open={showDialog}
          onClose={() => setShowDialog(false)}
          userEmail={currentUser.email}
          userId={currentUser._id}
          subscriptionTier={currentUser.subscriptionTier}
        />
      )}
    </div>
  );
}
