/**
 * Weekly Check-In Page — /check-in
 * Supports two modes:
 *   - Initial (?initial=true): Baseline check-in before AI plan is revealed
 *   - Weekly: Ongoing weekly progress check-in
 */

import { useState, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Progress } from "@/components/ui/progress.tsx";
import {
  Camera, Scale, Activity, Sparkles, CheckCircle, ChevronRight,
  BarChart3, ArrowLeft, TrendingUp, TrendingDown, Minus,
  RefreshCcw, ChevronDown, ChevronUp, Zap, Lock,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { cn } from "@/lib/utils.ts";
import { motion, AnimatePresence } from "motion/react";
import type { Id } from "@/convex/_generated/dataModel.js";

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = "metrics" | "performance" | "photos" | "notes" | "done";
const STEPS: Step[] = ["metrics", "performance", "photos", "notes", "done"];

// ─── Rating Picker ─────────────────────────────────────────────────────────────

function RatingPicker({
  label,
  value,
  onChange,
  low,
  high,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  low: string;
  high: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-semibold">{label}</Label>
        <span className="text-xs font-bold text-primary">{value}/5</span>
      </div>
      <div className="flex gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={cn(
              "flex-1 h-10 rounded-xl font-bold text-sm transition-all cursor-pointer",
              value === n
                ? "bg-primary text-primary-foreground shadow-sm shadow-primary/30"
                : "bg-muted text-muted-foreground hover:bg-muted/70"
            )}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground px-1">
        <span>{low}</span>
        <span>{high}</span>
      </div>
    </div>
  );
}

// ─── Photo Uploader ─────────────────────────────────────────────────────────────

function PhotoUploader({
  label,
  storageId,
  onUploaded,
  required,
}: {
  label: string;
  storageId: Id<"_storage"> | null;
  onUploaded: (id: Id<"_storage">) => void;
  required?: boolean;
}) {
  const generateUrl = useMutation(api.weeklyCheckIns.generatePhotoUploadUrl);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }
    setUploading(true);
    try {
      const previewUrl = URL.createObjectURL(file);
      setPreview(previewUrl);
      const uploadUrl = await generateUrl();
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      const { storageId: newId } = await res.json() as { storageId: Id<"_storage"> };
      onUploaded(newId);
      toast.success(`${label} uploaded`);
    } catch {
      toast.error("Upload failed — please try again");
      setPreview(null);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-2">
      <Label className="text-sm font-semibold">
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </Label>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className={cn(
          "w-full aspect-square rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-2 transition-all cursor-pointer",
          storageId
            ? "border-primary/40 bg-primary/5"
            : required
            ? "border-primary/30 hover:border-primary/60 hover:bg-primary/3"
            : "border-border hover:border-primary/40 hover:bg-primary/3",
          uploading && "opacity-60 cursor-not-allowed"
        )}
      >
        {preview || storageId ? (
          <>
            {preview && (
              <img src={preview} alt={label} className="w-full h-full object-cover rounded-xl" />
            )}
            {storageId && !preview && (
              <div className="flex flex-col items-center gap-1">
                <CheckCircle className="w-6 h-6 text-primary" />
                <span className="text-xs text-primary font-semibold">Uploaded</span>
              </div>
            )}
          </>
        ) : uploading ? (
          <div className="flex flex-col items-center gap-1">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-muted-foreground">Uploading...</span>
          </div>
        ) : (
          <>
            <Camera className="w-6 h-6 text-muted-foreground/50" />
            <span className="text-xs text-muted-foreground">Tap to upload</span>
          </>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="user"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />
    </div>
  );
}

// ─── History Card ─────────────────────────────────────────────────────────────

function CheckInHistoryCard() {
  const checkIns = useQuery(api.weeklyCheckIns.listMyCheckIns, {});
  const [expanded, setExpanded] = useState<string | null>(null);

  if (!checkIns || checkIns.length === 0) return null;

  // Show non-initial check-ins in history; initial check-in shows as baseline
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
        <BarChart3 className="w-3.5 h-3.5" /> Check-In History
      </h2>
      {checkIns.slice(0, 6).map((c) => (
        <Card key={c._id} className="border-border bg-card overflow-hidden">
          <button
            type="button"
            onClick={() => setExpanded(prev => prev === c._id ? null : c._id)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/15 transition-colors cursor-pointer text-left"
          >
            <div className="flex items-center gap-3">
              <div className={cn(
                "w-8 h-8 rounded-xl flex items-center justify-center shrink-0",
                c.isInitialCheckIn ? "bg-chart-3/15" : "bg-primary/10"
              )}>
                {c.isInitialCheckIn
                  ? <Zap className="w-3.5 h-3.5 text-chart-3" />
                  : <span className="text-xs font-black text-primary">W{c.weekNumber}</span>
                }
              </div>
              <div>
                <p className="font-semibold text-sm">
                  {c.isInitialCheckIn ? "Baseline Check-In" : `Week ${c.weekNumber}`}
                </p>
                <p className="text-[10px] text-muted-foreground">{c.checkInDate} · {c.weightKg}kg</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {c.estimatedBodyFatPct && (
                <Badge variant="secondary" className="text-[10px]">
                  ~{c.estimatedBodyFatPct}% BF
                </Badge>
              )}
              {c.aiAssessmentStatus === "done" && (
                <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px]">
                  <Sparkles className="w-2.5 h-2.5 mr-0.5" />AI
                </Badge>
              )}
              {c.aiAssessmentStatus === "pending" && (
                <Badge variant="secondary" className="text-[10px]">
                  <RefreshCcw className="w-2.5 h-2.5 mr-0.5 animate-spin" />Analyzing
                </Badge>
              )}
              {expanded === c._id ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </div>
          </button>
          {expanded === c._id && (
            <div className="border-t border-border/50 px-4 py-4 space-y-4">
              {/* Metrics */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-muted/30 rounded-lg px-3 py-2">
                  <p className="text-muted-foreground mb-0.5">Weight</p>
                  <p className="font-bold">{c.weightKg}kg</p>
                </div>
                {c.estimatedBMI && (
                  <div className="bg-muted/30 rounded-lg px-3 py-2">
                    <p className="text-muted-foreground mb-0.5">Est. BMI</p>
                    <p className="font-bold">{c.estimatedBMI}</p>
                  </div>
                )}
                {c.estimatedBodyFatPct && (
                  <div className="bg-primary/5 border border-primary/15 rounded-lg px-3 py-2 col-span-2">
                    <p className="text-muted-foreground mb-0.5 text-[10px]">Est. Body Fat (AI estimate, not medical)</p>
                    <p className="font-bold text-primary">~{c.estimatedBodyFatPct}%</p>
                  </div>
                )}
                {c.waistCm && (
                  <div className="bg-muted/30 rounded-lg px-3 py-2">
                    <p className="text-muted-foreground mb-0.5">Waist</p>
                    <p className="font-bold">{c.waistCm}cm</p>
                  </div>
                )}
                {c.chestCm && (
                  <div className="bg-muted/30 rounded-lg px-3 py-2">
                    <p className="text-muted-foreground mb-0.5">Chest</p>
                    <p className="font-bold">{c.chestCm}cm</p>
                  </div>
                )}
                {c.armsCm && (
                  <div className="bg-muted/30 rounded-lg px-3 py-2">
                    <p className="text-muted-foreground mb-0.5">Arms</p>
                    <p className="font-bold">{c.armsCm}cm</p>
                  </div>
                )}
              </div>
              {/* Performance bars */}
              {!c.isInitialCheckIn && (
                <div className="space-y-1.5">
                  {[
                    { label: "Energy", val: c.energyLevel },
                    { label: "Sleep", val: c.sleepQuality },
                    { label: "Recovery", val: c.recoveryScore },
                  ].map(({ label, val }) => (
                    <div key={label} className="flex items-center gap-2 text-xs">
                      <span className="w-16 text-muted-foreground shrink-0">{label}</span>
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full" style={{ width: `${(val / 5) * 100}%` }} />
                      </div>
                      <span className="text-muted-foreground">{val}/5</span>
                    </div>
                  ))}
                </div>
              )}
              {/* AI Assessment */}
              {c.aiAssessment && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-primary flex items-center gap-1">
                    <Sparkles className="w-2.5 h-2.5" />AI Assessment
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{c.aiAssessment}</p>
                </div>
              )}
              {/* Photos */}
              {(c.frontPhotoUrl || c.sidePhotoUrl || c.backPhotoUrl) && (
                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    { url: c.frontPhotoUrl, label: "Front" },
                    { url: c.sidePhotoUrl, label: "Side" },
                    { url: c.backPhotoUrl, label: "Back" },
                  ].filter(x => x.url).map(({ url, label }) => (
                    <div key={label} className="relative rounded-lg overflow-hidden aspect-[3/4] bg-muted">
                      <img src={url!} alt={label} className="w-full h-full object-cover" />
                      <span className="absolute bottom-1 left-1 text-[10px] bg-black/60 text-white px-1.5 py-0.5 rounded font-semibold">{label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

// ─── Main Check-In Page ──────────────────────────────────────────────────────

export default function CheckInPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isInitialMode = searchParams.get("initial") === "true";

  const planProgress = useQuery(api.weeklyCheckIns.getPlanProgress, {});
  const onboardingStatus = useQuery(api.weeklyCheckIns.getOnboardingStatus, {});
  const submitCheckIn = useMutation(api.weeklyCheckIns.submitCheckIn);

  const [step, setStep] = useState<Step>("metrics");
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [weightKg, setWeightKg] = useState("");
  const [waistCm, setWaistCm] = useState("");
  const [chestCm, setChestCm] = useState("");
  const [armsCm, setArmsCm] = useState("");
  const [legsCm, setLegsCm] = useState("");
  const [shouldersCm, setShouldersCm] = useState("");
  const [energyLevel, setEnergyLevel] = useState(3);
  const [sleepQuality, setSleepQuality] = useState(3);
  const [recoveryScore, setRecoveryScore] = useState(3);
  const [hungerLevel, setHungerLevel] = useState(3);
  const [strengthChange, setStrengthChange] = useState<"decreased" | "same" | "increased">("same");
  const [frontPhotoId, setFrontPhotoId] = useState<Id<"_storage"> | null>(null);
  const [sidePhotoId, setSidePhotoId] = useState<Id<"_storage"> | null>(null);
  const [backPhotoId, setBackPhotoId] = useState<Id<"_storage"> | null>(null);
  const [challenges, setChallenges] = useState("");
  const [notes, setNotes] = useState("");

  const stepIndex = STEPS.indexOf(step);
  const progress = (stepIndex / (STEPS.length - 1)) * 100;

  const currentWeek = planProgress?.currentWeek ?? 1;

  // Determine if we're in initial mode (from URL param or no initial check-in yet)
  const effectiveInitialMode = isInitialMode || (
    onboardingStatus !== undefined &&
    onboardingStatus !== null &&
    onboardingStatus.hasOnboarding &&
    !onboardingStatus.hasInitialCheckIn
  );

  const handleSubmit = async () => {
    if (!weightKg || isNaN(parseFloat(weightKg))) {
      toast.error("Please enter your current weight");
      return;
    }
    if (effectiveInitialMode && (!frontPhotoId || !sidePhotoId || !backPhotoId)) {
      toast.error("Please upload all 3 physique photos for your baseline assessment");
      return;
    }
    setSubmitting(true);
    try {
      await submitCheckIn({
        weekNumber: effectiveInitialMode ? 0 : currentWeek,
        weightKg: parseFloat(weightKg),
        waistCm: waistCm ? parseFloat(waistCm) : undefined,
        chestCm: chestCm ? parseFloat(chestCm) : undefined,
        armsCm: armsCm ? parseFloat(armsCm) : undefined,
        legsCm: legsCm ? parseFloat(legsCm) : undefined,
        shouldersCm: shouldersCm ? parseFloat(shouldersCm) : undefined,
        energyLevel,
        sleepQuality,
        recoveryScore,
        hungerLevel,
        strengthChange,
        frontPhotoStorageId: frontPhotoId ?? undefined,
        sidePhotoStorageId: sidePhotoId ?? undefined,
        backPhotoStorageId: backPhotoId ?? undefined,
        challenges: challenges || undefined,
        notes: notes || undefined,
        isInitialCheckIn: effectiveInitialMode ? true : undefined,
      });
      setStep("done");
    } catch (err) {
      toast.error("Failed to submit check-in. Please try again.");
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  if (onboardingStatus === undefined) {
    return (
      <div className="max-w-lg mx-auto px-4 pt-6 space-y-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 pt-6 pb-8 space-y-6">
      {/* Header */}
      <div className="relative overflow-hidden">
        <div className="absolute -top-6 -right-6 w-32 h-32 rounded-full bg-primary/8 blur-3xl pointer-events-none" />
        <div className="flex items-center gap-2 mb-1">
          {effectiveInitialMode ? (
            <Badge className="bg-chart-3/15 text-chart-3 border-chart-3/25 text-[10px] font-bold rounded-full px-2.5">
              BASELINE CHECK-IN
            </Badge>
          ) : (
            <Badge className="bg-primary/15 text-primary border-primary/25 text-[10px] font-bold rounded-full px-2.5">
              WEEK {currentWeek} / 12
            </Badge>
          )}
        </div>
        <h1 className="text-3xl font-black tracking-tight">
          {effectiveInitialMode ? "Baseline Check-In" : "Weekly Check-In"}<span className="text-primary">.</span>
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {effectiveInitialMode
            ? "Before your AI plan is revealed, the coach needs your baseline data to personalize everything."
            : "Track your progress — AI will analyze your data and provide feedback."}
        </p>
      </div>

      {/* Initial mode info banner */}
      {effectiveInitialMode && step !== "done" && (
        <Card className="border-chart-3/30 bg-chart-3/5">
          <CardContent className="p-4 flex items-start gap-3">
            <Zap className="w-4 h-4 text-chart-3 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold">Why this matters</p>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                Your AI coach uses this baseline to calibrate your personalized 12-week plan, set accurate targets, and measure real progress over time. Photos are analyzed for body composition estimates.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Progress bar (only during form) */}
      {step !== "done" && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span>{["Measurements", "Performance", "Photos", "Notes"][stepIndex]}</span>
            <span>{stepIndex + 1} / {STEPS.length - 1}</span>
          </div>
          <Progress value={progress} className="h-1.5" />
        </div>
      )}

      {/* Step content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.2 }}
        >
          {/* ── Step 1: Measurements ── */}
          {step === "metrics" && (
            <Card className="border-border bg-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Scale className="w-4 h-4 text-primary" />
                  Body Measurements
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="weight" className="font-semibold">
                    Body Weight <span className="text-destructive">*</span>
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="weight"
                      type="number"
                      step="0.1"
                      placeholder="75.5"
                      value={weightKg}
                      onChange={(e) => setWeightKg(e.target.value)}
                      className="flex-1"
                    />
                    <span className="text-sm text-muted-foreground font-medium">kg</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {[
                    { id: "waist", label: "Waist", val: waistCm, set: setWaistCm },
                    { id: "chest", label: "Chest", val: chestCm, set: setChestCm },
                    { id: "arms", label: "Arms", val: armsCm, set: setArmsCm },
                    { id: "legs", label: "Legs / Thighs", val: legsCm, set: setLegsCm },
                    { id: "shoulders", label: "Shoulders (opt.)", val: shouldersCm, set: setShouldersCm },
                  ].map(({ id, label, val, set }) => (
                    <div key={id} className="space-y-1.5">
                      <Label htmlFor={id} className="text-xs text-muted-foreground">{label}</Label>
                      <div className="flex items-center gap-1.5">
                        <Input
                          id={id}
                          type="number"
                          step="0.5"
                          placeholder="0"
                          value={val}
                          onChange={(e) => set(e.target.value)}
                        />
                        <span className="text-xs text-muted-foreground">cm</span>
                      </div>
                    </div>
                  ))}
                </div>

                <Button
                  className="w-full cursor-pointer gap-2"
                  onClick={() => {
                    if (!weightKg) { toast.error("Weight is required"); return; }
                    setStep("performance");
                  }}
                >
                  Next: Performance <ChevronRight className="w-4 h-4" />
                </Button>
              </CardContent>
            </Card>
          )}

          {/* ── Step 2: Performance ── */}
          {step === "performance" && (
            <Card className="border-border bg-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="w-4 h-4 text-primary" />
                  {effectiveInitialMode ? "Current Lifestyle" : "Performance & Recovery"}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {effectiveInitialMode && (
                  <p className="text-xs text-muted-foreground">
                    Rate your typical levels over the past week. This helps the AI understand your starting point.
                  </p>
                )}
                <RatingPicker label="Energy Levels" value={energyLevel} onChange={setEnergyLevel} low="Very low" high="Excellent" />
                <RatingPicker label="Sleep Quality" value={sleepQuality} onChange={setSleepQuality} low="Poor" high="Great" />
                <RatingPicker label="Recovery / Soreness" value={recoveryScore} onChange={setRecoveryScore} low="Always sore" high="Recover fast" />
                <RatingPicker label="Hunger / Appetite" value={hungerLevel} onChange={setHungerLevel} low="Always hungry" high="Well controlled" />

                {!effectiveInitialMode && (
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold">Strength This Week</Label>
                    <div className="grid grid-cols-3 gap-2">
                      {([
                        { v: "decreased" as const, icon: <TrendingDown className="w-4 h-4" />, label: "Decreased" },
                        { v: "same" as const, icon: <Minus className="w-4 h-4" />, label: "Same" },
                        { v: "increased" as const, icon: <TrendingUp className="w-4 h-4" />, label: "Increased" },
                      ]).map((opt) => (
                        <button
                          key={opt.v}
                          type="button"
                          onClick={() => setStrengthChange(opt.v)}
                          className={cn(
                            "flex flex-col items-center gap-1.5 py-3 rounded-xl border text-xs font-semibold transition-all cursor-pointer",
                            strengthChange === opt.v
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border text-muted-foreground hover:border-border/80"
                          )}
                        >
                          {opt.icon}
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex gap-2">
                  <Button variant="ghost" className="flex-1 cursor-pointer" onClick={() => setStep("metrics")}>
                    <ArrowLeft className="w-4 h-4 mr-1" /> Back
                  </Button>
                  <Button className="flex-1 cursor-pointer gap-2" onClick={() => setStep("photos")}>
                    Next: Photos <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── Step 3: Photos ── */}
          {step === "photos" && (
            <Card className="border-border bg-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Camera className="w-4 h-4 text-primary" />
                  Progress Photos
                  {effectiveInitialMode
                    ? <Badge className="bg-destructive/10 text-destructive border-destructive/20 text-[10px] ml-1">Required</Badge>
                    : <Badge variant="secondary" className="text-[10px] ml-1">Optional</Badge>
                  }
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  {effectiveInitialMode
                    ? "Photos are required for baseline body composition analysis. The AI estimates body fat % and BMI from your physique to track real changes over 12 weeks. All photos stored privately."
                    : "Photos help the AI track body composition changes over time. Stored privately."
                  }
                </p>
                <div className="grid grid-cols-3 gap-3">
                  <PhotoUploader label="Front" storageId={frontPhotoId} onUploaded={setFrontPhotoId} required={effectiveInitialMode} />
                  <PhotoUploader label="Side" storageId={sidePhotoId} onUploaded={setSidePhotoId} required={effectiveInitialMode} />
                  <PhotoUploader label="Back" storageId={backPhotoId} onUploaded={setBackPhotoId} required={effectiveInitialMode} />
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" className="flex-1 cursor-pointer" onClick={() => setStep("performance")}>
                    <ArrowLeft className="w-4 h-4 mr-1" /> Back
                  </Button>
                  <Button
                    className="flex-1 cursor-pointer gap-2"
                    onClick={() => {
                      if (effectiveInitialMode && (!frontPhotoId || !sidePhotoId || !backPhotoId)) {
                        toast.error("All 3 photos are required for your baseline");
                        return;
                      }
                      setStep("notes");
                    }}
                  >
                    Next: Notes <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── Step 4: Notes ── */}
          {step === "notes" && (
            <Card className="border-border bg-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-primary" />
                  {effectiveInitialMode ? "Goals & Context" : "Notes & Challenges"}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="challenges">
                    {effectiveInitialMode ? "What has been your biggest challenge with fitness so far?" : "Any challenges this week?"}
                  </Label>
                  <Textarea
                    id="challenges"
                    placeholder={effectiveInitialMode
                      ? "e.g. Lack of consistency, not sure what to eat, injuries..."
                      : "e.g. Missed 2 workouts due to travel, struggled with late-night snacking..."
                    }
                    value={challenges}
                    onChange={(e) => setChallenges(e.target.value)}
                    rows={3}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="notes">
                    {effectiveInitialMode ? "Anything else your AI coach should know?" : "Additional notes for AI coach"}
                  </Label>
                  <Textarea
                    id="notes"
                    placeholder={effectiveInitialMode
                      ? "e.g. Work schedule, travel schedule, health conditions, previous injuries..."
                      : "e.g. Feeling stronger on bench, want to add more cardio..."
                    }
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                  />
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" className="flex-1 cursor-pointer" onClick={() => setStep("photos")}>
                    <ArrowLeft className="w-4 h-4 mr-1" /> Back
                  </Button>
                  <Button
                    className="flex-1 cursor-pointer gap-2"
                    onClick={handleSubmit}
                    disabled={submitting}
                  >
                    {submitting ? (
                      <>
                        <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                        Submitting...
                      </>
                    ) : (
                      <>
                        {effectiveInitialMode ? "Submit Baseline" : "Submit Check-In"} <CheckCircle className="w-4 h-4" />
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── Step 5: Done ── */}
          {step === "done" && (
            <Card className="border-primary/30 bg-primary/5 overflow-hidden relative">
              <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary/0 via-primary to-primary/0" />
              <CardContent className="pt-8 pb-8 text-center space-y-4">
                <div className="w-16 h-16 rounded-2xl bg-primary/20 flex items-center justify-center mx-auto">
                  <CheckCircle className="w-8 h-8 text-primary" />
                </div>
                <div>
                  <h2 className="text-2xl font-black mb-2">
                    {effectiveInitialMode ? "Baseline Submitted!" : "Check-In Submitted!"}
                  </h2>
                  <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                    {effectiveInitialMode
                      ? "Your AI coach is analyzing your baseline data. Your personalized 12-week plan will be ready shortly."
                      : "Your AI coach is analyzing your data. Come back in a minute to see your personalized assessment."
                    }
                  </p>
                </div>
                <div className="flex items-center justify-center gap-2 py-2 px-4 bg-primary/10 rounded-xl border border-primary/20 w-fit mx-auto">
                  <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs font-semibold text-primary">
                    {effectiveInitialMode ? "AI building your plan..." : "AI assessment in progress..."}
                  </span>
                </div>
                {effectiveInitialMode ? (
                  <Button className="w-full cursor-pointer gap-2" onClick={() => navigate("/ai-plan")}>
                    View My AI Plan <ChevronRight className="w-4 h-4" />
                  </Button>
                ) : (
                  <div className="flex gap-2 pt-2">
                    <Button variant="ghost" className="flex-1 cursor-pointer" onClick={() => navigate(-1)}>
                      Back
                    </Button>
                    <Button className="flex-1 cursor-pointer gap-2" onClick={() => navigate("/dashboard")}>
                      Dashboard <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </motion.div>
      </AnimatePresence>

      {/* History (shown always below form, only in weekly mode) */}
      {step !== "done" && !effectiveInitialMode && <CheckInHistoryCard />}
    </div>
  );
}
