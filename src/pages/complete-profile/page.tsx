/**
 * Canonical Goat Walk onboarding flow.
 *
 * This is the SINGLE entry point for all new users after account creation.
 * It replaces the old "Complete Profile" step and unifies:
 *   - Profile setup (name + photo)
 *   - Fitness personalisation (goal, experience, training, body, nutrition, coaching style)
 *   - Body Scan intro (stub — real scan tech TBD)
 *   - Subscription conversion
 *
 * Routing:
 *   /complete-profile  →  this page  (OnboardingGate redirects here when !onboardingCompleted)
 *
 * Persistence:
 *   - saveOnboardingProgress is called after every "Continue" so the backend
 *     is the source of truth.  Returning users resume from their last step.
 *   - onboardingCompleted is set to true only at the very final step.
 *
 * Backend single source of truth:
 *   - users.onboardingCompleted  — controls the OnboardingGate and all routing
 *   - premiumOnboarding.onboardingStep — last completed step index for resume
 *   - premiumOnboarding — all personalisation data read by the AI Coach
 */

import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useAction } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import { Progress } from "@/components/ui/progress.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { motion, AnimatePresence } from "motion/react";
import {
  Target, Dumbbell, Utensils, User, ChevronRight, ChevronLeft,
  Sparkles, Loader2, Camera, Upload, Scan, CreditCard,
  Zap, Brain, BarChart3, CheckCircle2, Check,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils.ts";
import AvatarCropModal from "@/components/avatar-crop-modal.tsx";

// ─── Types ────────────────────────────────────────────────────────────────────

type Goal = "build_muscle" | "lose_fat" | "recomp";
type Sex = "male" | "female" | "other";
type Experience = "beginner" | "intermediate" | "advanced";
type GymAccess = "full_gym" | "home_gym" | "bodyweight";
type CoachingStyle = "motivational" | "analytical" | "balanced";

type FormData = {
  // Step 0: profile
  name: string;
  // Steps 1-7: personalisation
  primaryGoal: Goal | "";
  trainingExperience: Experience | "";
  trainingDaysPerWeek: string;
  gymAccess: GymAccess | "";
  preferredSplit: string;
  currentWeightKg: string;
  heightCm: string;
  age: string;
  sex: Sex | "";
  targetWeightKg: string;
  dietaryPreference: string;
  allergiesRestrictions: string;
  mealsPerDay: string;
  coachingStyle: CoachingStyle | "";
  marketingConsent: boolean;
};

// Step 0 = profile setup
// Step 1 = goal
// Step 2 = experience
// Step 3 = training setup
// Step 4 = body profile
// Step 5 = nutrition
// Step 6 = coaching style
// Step 7 = body scan intro (stub)
// Step 8 = subscription
// (Step 9 = dashboard — handled by navigate)
const TOTAL_STEPS = 9;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function OptionButton<T extends string>({
  value, selected, onSelect, label, description, icon,
}: {
  value: T; selected: boolean; onSelect: (v: T) => void;
  label: string; description?: string; icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      className={cn(
        "w-full text-left p-4 rounded-2xl border-2 transition-all cursor-pointer active:scale-[0.98]",
        selected
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border bg-card hover:border-primary/40 text-muted-foreground hover:text-foreground"
      )}
    >
      <div className="flex items-center gap-3">
        {icon && (
          <div className={cn(
            "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
            selected ? "bg-primary/20 text-primary" : "bg-muted/60 text-muted-foreground"
          )}>
            {icon}
          </div>
        )}
        {!icon && (
          <div className={cn(
            "w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0",
            selected ? "border-primary bg-primary" : "border-border"
          )}>
            {selected && <div className="w-2 h-2 bg-primary-foreground rounded-full" />}
          </div>
        )}
        <div className="min-w-0">
          <p className={cn("font-semibold text-sm", selected ? "text-foreground" : "")}>{label}</p>
          {description && <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{description}</p>}
        </div>
        {icon && selected && (
          <CheckCircle2 className="w-5 h-5 text-primary ml-auto shrink-0" />
        )}
      </div>
    </button>
  );
}

function StepHeader({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="flex items-start gap-3 mb-6">
      <div className="w-11 h-11 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
        {icon}
      </div>
      <div>
        <h2 className="text-xl font-bold leading-tight">{title}</h2>
        {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

// ─── Avatar upload ─────────────────────────────────────────────────────────────

function AvatarUploadArea({ preview, onFileSelect }: { preview: string | null; onFileSelect: (f: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [cropSrc, setCropSrc] = useState<string | null>(null);

  const openCrop = (file: File) => setCropSrc(URL.createObjectURL(file));

  return (
    <>
      <div className="flex flex-col items-center gap-3">
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault(); setDragging(false);
            const file = e.dataTransfer.files[0];
            if (file?.type.startsWith("image/")) openCrop(file);
          }}
          className={cn(
            "relative w-28 h-28 rounded-full cursor-pointer transition-all border-2 border-dashed flex items-center justify-center overflow-hidden group",
            dragging ? "border-primary bg-primary/10" : "border-border hover:border-primary/60 bg-muted/40"
          )}
        >
          {preview ? (
            <>
              <img src={preview} alt="Avatar" className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                <Camera className="w-6 h-6 text-white" />
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center gap-1 text-muted-foreground group-hover:text-foreground transition-colors">
              <Upload className="w-6 h-6" />
              <span className="text-[10px] font-medium">Upload photo</span>
            </div>
          )}
        </div>
        <input ref={inputRef} type="file" accept="image/*" className="sr-only"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) openCrop(f); e.target.value = ""; }} />
        <p className="text-[11px] text-muted-foreground text-center">JPG, PNG, WebP · Max 10MB</p>
      </div>
      {cropSrc && (
        <AvatarCropModal open imageSrc={cropSrc}
          onConfirm={(f) => { setCropSrc(null); onFileSelect(f); }}
          onCancel={() => setCropSrc(null)} />
      )}
    </>
  );
}

// ─── Step components ──────────────────────────────────────────────────────────

function Step0Profile({ form, onChange, avatarFile, onAvatarSelect, preview }: {
  form: FormData; onChange: (k: keyof FormData, v: string | boolean) => void;
  avatarFile: File | null; onAvatarSelect: (f: File) => void; preview: string | null;
}) {
  return (
    <div className="space-y-6">
      <StepHeader icon={<User className="w-5 h-5 text-primary" />} title="Create your profile" subtitle="Set your name and photo to get started" />
      <div className="flex flex-col items-center">
        <AvatarUploadArea preview={preview} onFileSelect={onAvatarSelect} />
        {!avatarFile && (
          <p className="text-xs text-destructive mt-2 text-center">A profile photo is required</p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="name">Full Name <span className="text-destructive">*</span></Label>
        <Input id="name" value={form.name} onChange={(e) => onChange("name", e.target.value)}
          placeholder="e.g. Jordan Smith" className="text-base h-12" autoFocus />
      </div>
      <div className="flex items-start gap-3">
        <Checkbox id="mkt" checked={form.marketingConsent}
          onCheckedChange={(c) => onChange("marketingConsent", c === true)}
          className="mt-0.5 cursor-pointer" />
        <Label htmlFor="mkt" className="text-sm text-muted-foreground leading-snug cursor-pointer">
          Send me Goat Walk updates, offers, and fitness content.{" "}
          <span className="text-muted-foreground/60">(Optional)</span>
        </Label>
      </div>
    </div>
  );
}

function Step1Goal({ form, onChange }: { form: FormData; onChange: (k: keyof FormData, v: string) => void }) {
  const goals = [
    { value: "build_muscle" as Goal, label: "Build Muscle", desc: "Hypertrophy-focused training to maximise muscle growth", icon: <Dumbbell className="w-5 h-5" /> },
    { value: "lose_fat" as Goal, label: "Lose Fat", desc: "Calorie-controlled plan to shed fat while preserving muscle", icon: <BarChart3 className="w-5 h-5" /> },
    { value: "recomp" as Goal, label: "Body Recomposition", desc: "Simultaneously build muscle and lose fat", icon: <Target className="w-5 h-5" /> },
  ];
  return (
    <div className="space-y-4">
      <StepHeader icon={<Target className="w-5 h-5 text-primary" />} title="What is your primary goal?" subtitle="This shapes every aspect of your plan" />
      <div className="space-y-3">
        {goals.map((g) => (
          <OptionButton key={g.value} value={g.value} selected={form.primaryGoal === g.value}
            onSelect={(v) => onChange("primaryGoal", v)} label={g.label} description={g.desc} icon={g.icon} />
        ))}
      </div>
    </div>
  );
}

function Step2Experience({ form, onChange }: { form: FormData; onChange: (k: keyof FormData, v: string) => void }) {
  const levels = [
    { value: "beginner" as Experience, label: "Beginner", desc: "Less than 1 year of consistent training", icon: <Sparkles className="w-5 h-5" /> },
    { value: "intermediate" as Experience, label: "Intermediate", desc: "1–3 years — know the basics well", icon: <Dumbbell className="w-5 h-5" /> },
    { value: "advanced" as Experience, label: "Advanced", desc: "3+ years of consistent, structured training", icon: <Zap className="w-5 h-5" /> },
  ];
  return (
    <div className="space-y-4">
      <StepHeader icon={<Dumbbell className="w-5 h-5 text-primary" />} title="Your fitness experience" subtitle="Helps calibrate your training intensity" />
      <div className="space-y-3">
        {levels.map((l) => (
          <OptionButton key={l.value} value={l.value} selected={form.trainingExperience === l.value}
            onSelect={(v) => onChange("trainingExperience", v)} label={l.label} description={l.desc} icon={l.icon} />
        ))}
      </div>
    </div>
  );
}

function Step3Training({ form, onChange }: { form: FormData; onChange: (k: keyof FormData, v: string) => void }) {
  const gymOptions = [
    { value: "full_gym" as GymAccess, label: "Full Gym", desc: "Barbells, machines, cables, full equipment" },
    { value: "home_gym" as GymAccess, label: "Home Gym", desc: "Dumbbells, some equipment" },
    { value: "bodyweight" as GymAccess, label: "Bodyweight Only", desc: "No equipment — anywhere, anytime" },
  ];
  const splits = ["Push/Pull/Legs", "Upper/Lower", "Full Body", "Bro Split", "AI decides"];
  return (
    <div className="space-y-5">
      <StepHeader icon={<Dumbbell className="w-5 h-5 text-primary" />} title="Training setup" subtitle="How you train determines your program structure" />
      <div className="space-y-2">
        <Label>Training days per week</Label>
        <div className="flex gap-2 flex-wrap">
          {[2, 3, 4, 5, 6].map((d) => (
            <button key={d} type="button"
              onClick={() => onChange("trainingDaysPerWeek", String(d))}
              className={cn(
                "w-14 h-14 rounded-2xl border-2 font-bold text-lg transition-all cursor-pointer",
                form.trainingDaysPerWeek === String(d)
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:border-primary/50"
              )}>
              {d}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <Label>Training location</Label>
        <div className="space-y-2">
          {gymOptions.map((g) => (
            <OptionButton key={g.value} value={g.value} selected={form.gymAccess === g.value}
              onSelect={(v) => onChange("gymAccess", v)} label={g.label} description={g.desc} />
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <Label>Preferred split <span className="text-muted-foreground text-xs">(optional)</span></Label>
        <div className="flex flex-wrap gap-2">
          {splits.map((s) => (
            <button key={s} type="button"
              onClick={() => onChange("preferredSplit", form.preferredSplit === s ? "" : s)}
              className={cn(
                "px-3 py-2 rounded-xl border text-sm font-medium transition-all cursor-pointer",
                form.preferredSplit === s
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:border-primary/50"
              )}>
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Step4Body({ form, onChange }: { form: FormData; onChange: (k: keyof FormData, v: string) => void }) {
  return (
    <div className="space-y-5">
      <StepHeader icon={<User className="w-5 h-5 text-primary" />} title="Your body profile" subtitle="Used to calculate accurate macro targets" />
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Current weight (kg)</Label>
          <Input type="number" placeholder="e.g. 80" value={form.currentWeightKg}
            onChange={(e) => onChange("currentWeightKg", e.target.value)} className="h-12" />
        </div>
        <div className="space-y-1.5">
          <Label>Height (cm)</Label>
          <Input type="number" placeholder="e.g. 175" value={form.heightCm}
            onChange={(e) => onChange("heightCm", e.target.value)} className="h-12" />
        </div>
        <div className="space-y-1.5">
          <Label>Age</Label>
          <Input type="number" placeholder="e.g. 25" value={form.age}
            onChange={(e) => onChange("age", e.target.value)} className="h-12" />
        </div>
        <div className="space-y-1.5">
          <Label>Target weight <span className="text-muted-foreground text-xs">(optional)</span></Label>
          <Input type="number" placeholder="e.g. 90" value={form.targetWeightKg}
            onChange={(e) => onChange("targetWeightKg", e.target.value)} className="h-12" />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Sex</Label>
        <div className="grid grid-cols-3 gap-2">
          {(["male", "female", "other"] as Sex[]).map((s) => (
            <button key={s} type="button"
              onClick={() => onChange("sex", s)}
              className={cn(
                "py-3 rounded-2xl border-2 font-medium text-sm transition-all cursor-pointer",
                form.sex === s
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:border-primary/50"
              )}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Step5Nutrition({ form, onChange }: { form: FormData; onChange: (k: keyof FormData, v: string) => void }) {
  const diets = ["Standard", "High Protein", "Vegetarian", "Vegan", "Keto / Low Carb", "Halal", "Kosher"];
  return (
    <div className="space-y-5">
      <StepHeader icon={<Utensils className="w-5 h-5 text-primary" />} title="Nutrition preferences" subtitle="Shapes your meal plan and food suggestions" />
      <div className="space-y-2">
        <Label>Dietary preference</Label>
        <div className="flex flex-wrap gap-2">
          {diets.map((d) => (
            <button key={d} type="button"
              onClick={() => onChange("dietaryPreference", d)}
              className={cn(
                "px-3 py-2 rounded-xl border text-sm font-medium transition-all cursor-pointer",
                form.dietaryPreference === d
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:border-primary/50"
              )}>
              {d}
            </button>
          ))}
        </div>
        <Input placeholder="Or type your own (e.g. Pescatarian)"
          value={diets.includes(form.dietaryPreference) ? "" : form.dietaryPreference}
          onChange={(e) => onChange("dietaryPreference", e.target.value)} className="mt-2" />
      </div>
      <div className="space-y-2">
        <Label>Meals per day <span className="text-muted-foreground text-xs">(optional)</span></Label>
        <div className="flex gap-2 flex-wrap">
          {[2, 3, 4, 5, 6].map((n) => (
            <button key={n} type="button"
              onClick={() => onChange("mealsPerDay", String(n))}
              className={cn(
                "w-14 h-14 rounded-2xl border-2 font-bold text-lg transition-all cursor-pointer",
                form.mealsPerDay === String(n)
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:border-primary/50"
              )}>
              {n}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Food allergies or restrictions <span className="text-muted-foreground text-xs">(optional)</span></Label>
        <Input placeholder="e.g. No dairy, nut allergy, no shellfish"
          value={form.allergiesRestrictions}
          onChange={(e) => onChange("allergiesRestrictions", e.target.value)} />
      </div>
    </div>
  );
}

function Step6CoachingStyle({ form, onChange }: { form: FormData; onChange: (k: keyof FormData, v: string) => void }) {
  const styles: { value: CoachingStyle; label: string; desc: string; icon: React.ReactNode }[] = [
    { value: "motivational", label: "Motivational", desc: "High energy, encouraging, celebrates wins", icon: <Zap className="w-5 h-5" /> },
    { value: "analytical", label: "Analytical", desc: "Data-driven, detailed breakdowns, no fluff", icon: <BarChart3 className="w-5 h-5" /> },
    { value: "balanced", label: "Balanced", desc: "Mix of encouragement and clear analysis", icon: <Brain className="w-5 h-5" /> },
  ];
  return (
    <div className="space-y-4">
      <StepHeader icon={<Brain className="w-5 h-5 text-primary" />} title="AI Coach personality" subtitle="How should your AI coach communicate with you?" />
      <div className="space-y-3">
        {styles.map((s) => (
          <OptionButton key={s.value} value={s.value} selected={form.coachingStyle === s.value}
            onSelect={(v) => onChange("coachingStyle", v)} label={s.label} description={s.desc} icon={s.icon} />
        ))}
      </div>
    </div>
  );
}

function Step7BodyScan({ onContinue }: { onContinue: () => void }) {
  const [scanning, setScanning] = useState(false);
  const [done, setDone] = useState(false);

  const startScan = () => {
    setScanning(true);
    // Simulated scan — real body scan technology will be integrated in a future release
    setTimeout(() => { setScanning(false); setDone(true); }, 2500);
  };

  return (
    <div className="space-y-6">
      <StepHeader
        icon={<Scan className="w-5 h-5 text-primary" />}
        title="Your free Body Scan"
        subtitle="One free scan for every new Goat Walk member"
      />

      <div className="bg-muted/40 rounded-2xl p-5 space-y-3 border border-border">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="w-4 h-4 text-primary" />
          What the Body Scan measures
        </div>
        {["Estimated body fat percentage", "Lean mass index", "Muscle symmetry assessment", "Personalised baseline for tracking progress"].map((item) => (
          <div key={item} className="flex items-center gap-2 text-sm text-muted-foreground">
            <Check className="w-4 h-4 text-primary shrink-0" />
            {item}
          </div>
        ))}
      </div>

      <div className="bg-primary/5 rounded-2xl p-4 border border-primary/20 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
          <Sparkles className="w-5 h-5 text-primary" />
        </div>
        <div>
          <p className="text-sm font-semibold">This scan is completely free</p>
          <p className="text-xs text-muted-foreground">One free scan per new member. Pro subscribers get 1 scan/month.</p>
        </div>
      </div>

      {!done ? (
        <Button onClick={startScan} disabled={scanning} className="w-full h-12 gap-2 cursor-pointer">
          {scanning ? (
            <><Loader2 className="w-4 h-4 animate-spin" />Scanning…</>
          ) : (
            <><Scan className="w-4 h-4" />Start Body Scan</>
          )}
        </Button>
      ) : (
        <div className="space-y-4">
          <div className="bg-card rounded-2xl p-5 border border-border space-y-3">
            <div className="flex items-center gap-2 font-semibold text-sm">
              <CheckCircle2 className="w-5 h-5 text-primary" />
              Scan Complete
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Body Fat", value: "~18%" },
                { label: "Lean Mass Index", value: "Good" },
                { label: "Symmetry", value: "Balanced" },
                { label: "Baseline Set", value: "Yes" },
              ].map(({ label, value }) => (
                <div key={label} className="bg-muted/50 rounded-xl p-3">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-sm font-bold mt-0.5">{value}</p>
                </div>
              ))}
            </div>
          </div>
          <Button onClick={onContinue} className="w-full h-12 gap-2 cursor-pointer">
            Continue to Goat Walk Pro
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

function Step8Subscription({ onSubscribe, onSkip, isLoading }: {
  onSubscribe: () => void; onSkip: () => void; isLoading: boolean;
}) {
  const features = [
    "AI-generated personalised fitness plan",
    "AI Nutrition plan with macro targets",
    "AI Coach — unlimited chat",
    "1 Body Scan per month",
    "Weekly check-ins and progress analytics",
    "Full exercise and workout library",
  ];
  return (
    <div className="space-y-5">
      <StepHeader icon={<CreditCard className="w-5 h-5 text-primary" />}
        title="Unlock Goat Walk Pro" subtitle="Everything you need to reach your goals" />

      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="bg-primary p-5 text-primary-foreground">
          <div className="flex items-baseline gap-1">
            <span className="text-4xl font-black">$24.99</span>
            <span className="text-primary-foreground/70">/month</span>
          </div>
          <p className="text-sm text-primary-foreground/80 mt-1">Cancel anytime</p>
        </div>
        <div className="p-5 space-y-3">
          {features.map((f) => (
            <div key={f} className="flex items-center gap-3 text-sm">
              <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <Check className="w-3 h-3 text-primary" />
              </div>
              {f}
            </div>
          ))}
        </div>
      </div>

      <Button onClick={onSubscribe} disabled={isLoading} className="w-full h-12 gap-2 cursor-pointer">
        {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
        Start Goat Walk Pro — $24.99/mo
      </Button>

      <Button variant="ghost" onClick={onSkip} disabled={isLoading}
        className="w-full cursor-pointer text-muted-foreground">
        Skip for now — enter free experience
      </Button>
    </div>
  );
}

// ─── Step labels for progress header ──────────────────────────────────────────

const STEP_LABELS = [
  "Profile", "Goal", "Experience", "Training",
  "Body", "Nutrition", "AI Coach", "Body Scan", "Subscribe",
];

// ─── Main onboarding component ────────────────────────────────────────────────

function OnboardingFlow() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [subLoading, setSubLoading] = useState(false);

  // Avatar state (not stored in form for type reasons)
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const [form, setForm] = useState<FormData>({
    name: "",
    primaryGoal: "",
    trainingExperience: "",
    trainingDaysPerWeek: "4",
    gymAccess: "",
    preferredSplit: "",
    currentWeightKg: "",
    heightCm: "",
    age: "",
    sex: "",
    targetWeightKg: "",
    dietaryPreference: "Standard",
    allergiesRestrictions: "",
    mealsPerDay: "",
    coachingStyle: "",
    marketingConsent: false,
  });

  // Mutations
  const saveProgress = useMutation(api.premiumOnboarding.saveOnboardingProgress);
  const saveOnboarding = useMutation(api.premiumOnboarding.saveOnboarding);
  const updateProfile = useMutation(api.users.updateProfile);
  const generateUploadUrl = useMutation(api.users.generateAvatarUploadUrl);
  const saveAvatar = useMutation(api.users.saveAvatar);
  const checkoutAction = useAction(api.commerce.subscriptions.checkout);
  // Load existing progress so returning users resume at the right step
  const existingProgress = useQuery(api.premiumOnboarding.getMyOnboarding, {});
  const currentUser = useQuery(api.users.getCurrentUser, {});

  useEffect(() => {
    if (existingProgress === undefined || currentUser === undefined) return;
    // Resume from last saved step
    if (existingProgress?.onboardingStep !== undefined && existingProgress.onboardingStep > 0) {
      setStep(existingProgress.onboardingStep + 1); // advance past the last completed step
    }
    // Pre-fill form from saved data
    if (existingProgress) {
      setForm((prev) => ({
        ...prev,
        primaryGoal: (existingProgress.primaryGoal as Goal) || "",
        trainingExperience: (existingProgress.trainingExperience as Experience) || "",
        trainingDaysPerWeek: String(existingProgress.trainingDaysPerWeek || 4),
        gymAccess: (existingProgress.gymAccess as GymAccess) || "",
        preferredSplit: existingProgress.preferredSplit || "",
        currentWeightKg: existingProgress.currentWeightKg ? String(existingProgress.currentWeightKg) : "",
        heightCm: existingProgress.heightCm ? String(existingProgress.heightCm) : "",
        age: existingProgress.age ? String(existingProgress.age) : "",
        sex: (existingProgress.sex as Sex) || "",
        targetWeightKg: existingProgress.targetWeightKg ? String(existingProgress.targetWeightKg) : "",
        dietaryPreference: existingProgress.dietaryPreference || "Standard",
        allergiesRestrictions: existingProgress.allergiesRestrictions || "",
        mealsPerDay: existingProgress.mealsPerDay ? String(existingProgress.mealsPerDay) : "",
        coachingStyle: (existingProgress.coachingStyle as CoachingStyle) || "",
      }));
    }
    if (currentUser?.name) {
      setForm((prev) => ({ ...prev, name: currentUser.name ?? "" }));
    }
  // Run once on load
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingProgress !== undefined, currentUser !== undefined]);

  const onChange = (key: keyof FormData, value: string | boolean) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  // ── Validation per step ───────────────────────────────────────────────────

  const canProceed = (): boolean => {
    switch (step) {
      case 0: return form.name.trim().length > 0 && avatarFile !== null;
      case 1: return form.primaryGoal !== "";
      case 2: return form.trainingExperience !== "";
      case 3: return form.trainingDaysPerWeek !== "" && form.gymAccess !== "";
      case 4:
        return (
          form.currentWeightKg !== "" && parseFloat(form.currentWeightKg) > 0 &&
          form.heightCm !== "" && parseFloat(form.heightCm) > 0 &&
          form.age !== "" && parseInt(form.age) > 0 &&
          form.sex !== ""
        );
      case 5: return form.dietaryPreference !== "";
      case 6: return form.coachingStyle !== "";
      default: return true;
    }
  };

  // ── Persist progress after each step ─────────────────────────────────────

  const persistStep = async (completedStep: number) => {
    try {
      const payload: Parameters<typeof saveProgress>[0] = { onboardingStep: completedStep };
      if (form.primaryGoal) payload.primaryGoal = form.primaryGoal as Goal;
      if (form.trainingExperience) payload.trainingExperience = form.trainingExperience as Experience;
      if (form.trainingDaysPerWeek) payload.trainingDaysPerWeek = parseInt(form.trainingDaysPerWeek);
      if (form.gymAccess) payload.gymAccess = form.gymAccess as GymAccess;
      if (form.preferredSplit) payload.preferredSplit = form.preferredSplit;
      if (form.currentWeightKg && parseFloat(form.currentWeightKg) > 0) payload.currentWeightKg = parseFloat(form.currentWeightKg);
      if (form.heightCm && parseFloat(form.heightCm) > 0) payload.heightCm = parseFloat(form.heightCm);
      if (form.age && parseInt(form.age) > 0) payload.age = parseInt(form.age);
      if (form.sex) payload.sex = form.sex as Sex;
      if (form.targetWeightKg && parseFloat(form.targetWeightKg) > 0) payload.targetWeightKg = parseFloat(form.targetWeightKg);
      if (form.dietaryPreference) payload.dietaryPreference = form.dietaryPreference;
      if (form.allergiesRestrictions) payload.allergiesRestrictions = form.allergiesRestrictions;
      if (form.mealsPerDay) payload.mealsPerDay = parseInt(form.mealsPerDay);
      if (form.coachingStyle) payload.coachingStyle = form.coachingStyle as CoachingStyle;
      await saveProgress(payload);
    } catch {
      // Non-fatal — progress save failure doesn't block the user
    }
  };

  // ── Step 0 submit: save name + avatar ────────────────────────────────────

  const submitProfile = async () => {
    if (!avatarFile) return;
    setSaving(true);
    try {
      await updateProfile({
        name: form.name.trim(),
        ...(form.marketingConsent ? {
          marketingConsent: true,
          marketingConsentAt: new Date().toISOString(),
        } : {}),
      });
      const uploadUrl = await generateUploadUrl();
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": avatarFile.type },
        body: avatarFile,
      });
      if (!res.ok) throw new Error("Upload failed");
      const { storageId } = await res.json() as { storageId: string };
      await saveAvatar({ storageId: storageId as Parameters<typeof saveAvatar>[0]["storageId"] });
      await persistStep(0);
      setStep(1);
    } catch {
      toast.error("Couldn't save your profile. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // ── Final submit: save all onboarding data and mark complete ─────────────

  const finishOnboarding = async () => {
    if (!form.primaryGoal || !form.trainingExperience || !form.gymAccess || !form.sex || !form.coachingStyle) {
      toast.error("Some required information is missing. Please go back and complete all steps.");
      return;
    }
    setSaving(true);
    try {
      await saveOnboarding({
        primaryGoal: form.primaryGoal as Goal,
        currentWeightKg: parseFloat(form.currentWeightKg),
        heightCm: parseFloat(form.heightCm),
        age: parseInt(form.age),
        sex: form.sex as Sex,
        trainingExperience: form.trainingExperience as Experience,
        trainingDaysPerWeek: parseInt(form.trainingDaysPerWeek),
        gymAccess: form.gymAccess as GymAccess,
        dietaryPreference: form.dietaryPreference,
        allergiesRestrictions: form.allergiesRestrictions || undefined,
        targetWeightKg: form.targetWeightKg ? parseFloat(form.targetWeightKg) : undefined,
        preferredSplit: form.preferredSplit || undefined,
        mealsPerDay: form.mealsPerDay ? parseInt(form.mealsPerDay) : undefined,
        coachingStyle: form.coachingStyle as CoachingStyle,
      });
      // Mark onboardingCompleted = true on the user record
      await updateProfile({ onboardingCompleted: true });
    } finally {
      setSaving(false);
    }
  };

  // ── Subscription handler ──────────────────────────────────────────────────

  const PREMIUM_VARIANT_ID = "var_goatwalk_premium_monthly";

  const handleSubscribe = async () => {
    setSubLoading(true);
    try {
      await finishOnboarding();
      const result = await checkoutAction({
        variantId: PREMIUM_VARIANT_ID,
        successUrl: window.location.origin + "/dashboard?success=1",
        cancelUrl: window.location.origin + "/dashboard",
      });
      if (result.url) {
        window.open(result.url, "_blank");
        // Navigate to dashboard immediately — subscription sync happens on return
        navigate("/dashboard", { replace: true });
      } else {
        navigate("/dashboard", { replace: true });
      }
    } catch {
      toast.error("Could not start checkout. Please try again.");
    } finally {
      setSubLoading(false);
    }
  };

  const handleSkipSubscription = async () => {
    setSaving(true);
    try {
      await finishOnboarding();
      navigate("/dashboard", { replace: true });
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // ── Continue handler ──────────────────────────────────────────────────────

  const handleContinue = async () => {
    if (!canProceed()) return;
    if (step === 0) { await submitProfile(); return; }
    await persistStep(step);
    setStep((s) => s + 1);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const progress = ((step + 1) / TOTAL_STEPS) * 100;
  const isLastDataStep = step === 6;

  // Show loading while we fetch saved progress
  if (existingProgress === undefined || currentUser === undefined) {
    return (
      <div className="min-h-dvh bg-background flex flex-col items-center justify-center gap-4 px-4">
        <Skeleton className="w-20 h-20 rounded-2xl" />
        <Skeleton className="w-48 h-5" />
        <Skeleton className="w-64 h-4" />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-background flex flex-col">
      {/* Header / progress */}
      <div className="shrink-0 border-b border-border bg-card/50 px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">
              {STEP_LABELS[step]} &mdash; Step {step + 1} of {TOTAL_STEPS}
            </p>
            <Progress value={progress} className="h-1.5 mt-1" />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-lg mx-auto px-4 py-6 pb-32">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
            >
              {step === 0 && (
                <Step0Profile form={form} onChange={onChange}
                  avatarFile={avatarFile}
                  onAvatarSelect={(f) => { setAvatarFile(f); setPreview(URL.createObjectURL(f)); }}
                  preview={preview} />
              )}
              {step === 1 && <Step1Goal form={form} onChange={onChange} />}
              {step === 2 && <Step2Experience form={form} onChange={onChange} />}
              {step === 3 && <Step3Training form={form} onChange={onChange} />}
              {step === 4 && <Step4Body form={form} onChange={onChange} />}
              {step === 5 && <Step5Nutrition form={form} onChange={onChange} />}
              {step === 6 && <Step6CoachingStyle form={form} onChange={onChange} />}
              {step === 7 && <Step7BodyScan onContinue={() => setStep(8)} />}
              {step === 8 && (
                <Step8Subscription
                  onSubscribe={() => void handleSubscribe()}
                  onSkip={() => void handleSkipSubscription()}
                  isLoading={subLoading || saving}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* Fixed bottom nav — hidden on body scan and subscription steps (they manage their own CTAs) */}
      {step < 7 && (
        <div className="fixed bottom-0 left-0 right-0 border-t border-border bg-background/95 backdrop-blur-sm px-4 py-4 shrink-0">
          <div className="max-w-lg mx-auto flex items-center gap-3">
            <Button variant="ghost" onClick={() => setStep((s) => s - 1)}
              disabled={step === 0 || saving}
              className="cursor-pointer gap-1.5 shrink-0">
              <ChevronLeft className="w-4 h-4" />
              Back
            </Button>

            <Button
              onClick={() => void handleContinue()}
              disabled={!canProceed() || saving}
              className="cursor-pointer gap-2 flex-1 h-12"
            >
              {saving ? (
                <><Loader2 className="w-4 h-4 animate-spin" />Saving…</>
              ) : isLastDataStep ? (
                <><Sparkles className="w-4 h-4" />Generate My Plan</>
              ) : (
                <>Continue<ChevronRight className="w-4 h-4" /></>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Gate: skip onboarding if already completed ───────────────────────────────

function OnboardingGateContent() {
  const navigate = useNavigate();
  const currentUser = useQuery(api.users.getCurrentUser, {});

  // If the user is already fully onboarded, send them straight to the dashboard.
  // We let the OnboardingGate handle the redirect for normal app routes, but this
  // guard ensures /complete-profile itself doesn't flash for returning users.
  useEffect(() => {
    if (currentUser === undefined) return;
    if (currentUser?.onboardingCompleted) {
      navigate("/dashboard", { replace: true });
    }
  }, [currentUser, navigate]);

  if (currentUser === undefined) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <Skeleton className="w-20 h-20 rounded-2xl" />
      </div>
    );
  }

  if (currentUser?.onboardingCompleted) return null;

  return <OnboardingFlow />;
}

import { Authenticated } from "convex/react";

export default function CompleteProfilePage() {
  return (
    <Authenticated>
      <OnboardingGateContent />
    </Authenticated>
  );
}
