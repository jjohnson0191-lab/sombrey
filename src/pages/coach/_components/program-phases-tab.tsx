import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty.tsx";
import {
  Plus, Trash2, Edit3, Check, X, Archive, RotateCcw, Layers,
  GripVertical, ChevronDown, ChevronUp,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils.ts";

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-500/15 text-green-500 border-green-500/30",
  completed: "bg-blue-500/15 text-blue-500 border-blue-500/30",
  archived: "bg-muted text-muted-foreground border-border",
};

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  completed: "Completed",
  archived: "Archived",
};

const PHASE_PRESETS = [
  "Foundation", "Fat Loss Phase 1", "Fat Loss Phase 2",
  "Muscle Growth", "Lean Bulk", "Maintenance",
  "Peak Week", "Deload", "Competition Prep",
];

type Phase = {
  _id: Id<"programPhases">;
  name: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  status: "active" | "completed" | "archived";
  displayOrder: number;
  clientId?: Id<"users">;
  clientName?: string | null;
  programName?: string | null;
  coachNotes?: string;
  programId?: Id<"programs">;
};

type PhaseFormData = {
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  status: "active" | "completed" | "archived";
  coachNotes: string;
  programId: string;
  clientId: string;
};

const DEFAULT_FORM: PhaseFormData = {
  name: "", description: "", startDate: "", endDate: "",
  status: "active", coachNotes: "", programId: "", clientId: "",
};

// ─── Phase Card ───────────────────────────────────────────────────────────────

function PhaseCard({ phase, onEdit, onDelete, onStatusChange }: {
  phase: Phase;
  onEdit: (phase: Phase) => void;
  onDelete: (id: Id<"programPhases">) => void;
  onStatusChange: (id: Id<"programPhases">, status: "active" | "completed" | "archived") => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className={cn("border-border bg-card transition-all", phase.status === "archived" && "opacity-60")}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <GripVertical className="w-4 h-4 text-muted-foreground/40 mt-1 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-black text-base">{phase.name}</span>
                <Badge className={cn("text-[10px] border", STATUS_COLORS[phase.status])}>
                  {STATUS_LABELS[phase.status]}
                </Badge>
                {phase.clientName && (
                  <Badge variant="secondary" className="text-[10px]">{phase.clientName}</Badge>
                )}
              </div>
              <div className="flex gap-1 shrink-0">
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 cursor-pointer" onClick={() => onEdit(phase)}>
                  <Edit3 className="w-3.5 h-3.5" />
                </Button>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 cursor-pointer text-destructive hover:text-destructive" onClick={() => onDelete(phase._id)}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 cursor-pointer" onClick={() => setExpanded((v) => !v)}>
                  {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </Button>
              </div>
            </div>

            {/* Dates */}
            {(phase.startDate ?? phase.endDate) && (
              <p className="text-xs text-muted-foreground mt-1">
                {phase.startDate ? format(parseISO(phase.startDate), "MMM d, yyyy") : "—"}
                {" → "}
                {phase.endDate ? format(parseISO(phase.endDate), "MMM d, yyyy") : "ongoing"}
              </p>
            )}

            {/* Description */}
            {phase.description && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{phase.description}</p>}

            {/* Expanded details */}
            <AnimatePresence>
              {expanded && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden">
                  <div className="mt-3 space-y-2 border-t border-border pt-3">
                    {phase.programName && (
                      <p className="text-xs"><span className="text-muted-foreground">Program:</span> {phase.programName}</p>
                    )}
                    {phase.coachNotes && (
                      <div className="bg-muted/40 rounded-lg p-3">
                        <p className="text-xs text-muted-foreground mb-1 font-medium">Coach Notes</p>
                        <p className="text-sm">{phase.coachNotes}</p>
                      </div>
                    )}
                    {/* Status actions */}
                    <div className="flex flex-wrap gap-2 pt-1">
                      {phase.status !== "active" && (
                        <Button size="sm" variant="secondary" className="cursor-pointer h-7 text-xs gap-1"
                          onClick={() => onStatusChange(phase._id, "active")}>
                          <RotateCcw className="w-3 h-3" /> Set Active
                        </Button>
                      )}
                      {phase.status === "active" && (
                        <Button size="sm" variant="secondary" className="cursor-pointer h-7 text-xs gap-1"
                          onClick={() => onStatusChange(phase._id, "completed")}>
                          <Check className="w-3 h-3" /> Mark Complete
                        </Button>
                      )}
                      {phase.status !== "archived" && (
                        <Button size="sm" variant="secondary" className="cursor-pointer h-7 text-xs gap-1"
                          onClick={() => onStatusChange(phase._id, "archived")}>
                          <Archive className="w-3 h-3" /> Archive
                        </Button>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Phase Form Dialog ────────────────────────────────────────────────────────

function PhaseFormDialog({ open, onOpenChange, editing }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: Phase | null;
}) {
  const [form, setForm] = useState<PhaseFormData>(DEFAULT_FORM);
  const createPhase = useMutation(api.programPhases.create);
  const updatePhase = useMutation(api.programPhases.update);
  const programs = useQuery(api.programs.list, {});
  const clients = useQuery(api.users.listClients, {});

  // Sync form when editing changes
  const wasOpen = open;
  if (wasOpen && editing && form.name === "" && editing.name) {
    setForm({
      name: editing.name,
      description: editing.description ?? "",
      startDate: editing.startDate ?? "",
      endDate: editing.endDate ?? "",
      status: editing.status,
      coachNotes: editing.coachNotes ?? "",
      programId: editing.programId ?? "",
      clientId: editing.clientId ?? "",
    });
  }

  const reset = () => setForm(DEFAULT_FORM);

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error("Phase name is required"); return; }
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description || undefined,
        startDate: form.startDate || undefined,
        endDate: form.endDate || undefined,
        status: form.status,
        coachNotes: form.coachNotes || undefined,
        programId: form.programId ? (form.programId as Id<"programs">) : undefined,
        clientId: form.clientId ? (form.clientId as Id<"users">) : undefined,
      };
      if (editing) {
        await updatePhase({ id: editing._id, ...payload });
        toast.success("Phase updated");
      } else {
        await createPhase(payload);
        toast.success("Phase created");
      }
      onOpenChange(false);
      reset();
    } catch { toast.error("Failed to save phase"); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Phase" : "Create Phase"}</DialogTitle>
          <DialogDescription>Define a training phase for your clients</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {/* Name + presets */}
          <div className="space-y-2">
            <Label>Phase Name *</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Fat Loss Phase 1" />
            <div className="flex flex-wrap gap-1.5">
              {PHASE_PRESETS.map((p) => (
                <button key={p} onClick={() => setForm({ ...form, name: p })}
                  className={cn("text-xs px-2 py-0.5 rounded-full border cursor-pointer transition-colors",
                    form.name === p ? "bg-foreground text-background border-foreground" : "bg-muted/40 text-muted-foreground border-border hover:border-foreground/50"
                  )}>
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="What is this phase about?" rows={2} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Start Date</Label>
              <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>End Date</Label>
              <Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
            </div>
          </div>

          {/* Client */}
          <div className="space-y-2">
            <Label>Assign to Client (optional)</Label>
            <Select value={form.clientId || "none"} onValueChange={(v) => setForm({ ...form, clientId: v === "none" ? "" : v })}>
              <SelectTrigger><SelectValue placeholder="All clients / unassigned" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">All clients / unassigned</SelectItem>
                {clients?.map((c) => (
                  <SelectItem key={c._id} value={c._id}>{c.name ?? c.email ?? "Unknown"}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Program */}
          <div className="space-y-2">
            <Label>Workout Program (optional)</Label>
            <Select value={form.programId || "none"} onValueChange={(v) => setForm({ ...form, programId: v === "none" ? "" : v })}>
              <SelectTrigger><SelectValue placeholder="No program" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No program</SelectItem>
                {programs?.map((p) => (
                  <SelectItem key={p._id} value={p._id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Status */}
          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as PhaseFormData["status"] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Coach Notes (private)</Label>
            <Textarea value={form.coachNotes} onChange={(e) => setForm({ ...form, coachNotes: e.target.value })}
              placeholder="Internal notes about this phase…" rows={2} />
          </div>

          <Button onClick={() => void handleSave()} className="w-full cursor-pointer">
            <Check className="w-4 h-4 mr-2" /> {editing ? "Update Phase" : "Create Phase"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ProgramPhasesTab() {
  const [showArchived, setShowArchived] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingPhase, setEditingPhase] = useState<Phase | null>(null);

  const phases = useQuery(api.programPhases.listByCoach, { includeArchived: showArchived });
  const removePhase = useMutation(api.programPhases.remove);
  const updatePhase = useMutation(api.programPhases.update);

  const handleEdit = (phase: Phase) => {
    setEditingPhase(phase);
    setFormOpen(true);
  };

  const handleDelete = async (id: Id<"programPhases">) => {
    try { await removePhase({ id }); toast.success("Phase deleted"); }
    catch { toast.error("Failed to delete phase"); }
  };

  const handleStatusChange = async (id: Id<"programPhases">, status: "active" | "completed" | "archived") => {
    try { await updatePhase({ id, status }); toast.success("Status updated"); }
    catch { toast.error("Failed to update status"); }
  };

  if (phases === undefined) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-black">Program Phases</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Create and manage training phases for your clients</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" className="cursor-pointer gap-1.5"
            onClick={() => setShowArchived((v) => !v)}>
            <Archive className="w-4 h-4" />
            {showArchived ? "Hide Archived" : "Show Archived"}
          </Button>
          <Button size="sm" className="cursor-pointer gap-1.5" onClick={() => { setEditingPhase(null); setFormOpen(true); }}>
            <Plus className="w-4 h-4" /> New Phase
          </Button>
        </div>
      </div>

      {/* Stats bar */}
      {phases.length > 0 && (
        <div className="flex gap-4 text-sm text-muted-foreground">
          <span><strong className="text-foreground">{phases.filter((p) => p.status === "active").length}</strong> active</span>
          <span><strong className="text-foreground">{phases.filter((p) => p.status === "completed").length}</strong> completed</span>
          {showArchived && <span><strong className="text-foreground">{phases.filter((p) => p.status === "archived").length}</strong> archived</span>}
        </div>
      )}

      {/* Phase list */}
      {phases.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><Layers /></EmptyMedia>
            <EmptyTitle>No phases yet</EmptyTitle>
            <EmptyDescription>Create custom training phases to structure your clients' journeys</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button className="cursor-pointer" onClick={() => { setEditingPhase(null); setFormOpen(true); }}>
              <Plus className="w-4 h-4 mr-2" /> Create First Phase
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="space-y-3">
          {phases.map((phase) => (
            <PhaseCard
              key={phase._id}
              phase={phase}
              onEdit={handleEdit}
              onDelete={(id) => void handleDelete(id)}
              onStatusChange={(id, status) => void handleStatusChange(id, status)}
            />
          ))}
        </div>
      )}

      {/* Form dialog */}
      <PhaseFormDialog
        open={formOpen}
        onOpenChange={(v) => { setFormOpen(v); if (!v) setEditingPhase(null); }}
        editing={editingPhase}
      />
    </div>
  );
}
