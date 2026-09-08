import { useState, useEffect } from "react";
import { Authenticated, useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Progress } from "@/components/ui/progress.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  Target,
  Dumbbell,
  Utensils,
  User,
  ChevronRight,
  ChevronLeft,
  Sparkles,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { cn } from "@/lib/utils.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

type Goal = "build_muscle" | "lose_fat" | "recomp";
type Sex = "male" | "female" | "other";
type Experience = "beginner" | "intermediate" | "advanced";
type GymAccess = "full_gym" | "home_gym" | "bodyweight";

type FormData = {
  primaryGoal: Goal | "";
  currentWeightKg: string;
  heightCm: string;
  age: string;
  sex: Sex | "";
  trainingExperience: Experience | "";
  trainingDaysPerWeek: string;
  gymAccess: GymAccess | "";
  dietaryPreference: string;
  allergiesRestrictions: string;
  targetWeightKg: string;
  preferredSplit: string;
};

// ─── Option Button ────────────────────────────────────────────────────────────

function OptionButton<T extends string>({
  value,
  selected,
  onSelect,
  label,
  description,
}: {
  value: T;
  selected: boolean;
  onSelect: (v: T) => void;
  label: string;
  description?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      className={cn(
        "w-full text-left p-4 rounded-xl border-2 transition-all cursor-pointer",
        selected
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border bg-card hover:border-primary/40 text-muted-foreground hover:text-foreground"
      )}
    >
      <div className="flex items-center gap-3">
        <div className={cn(
          "w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0",
          selected ? "border-primary bg-primary" : "border-border"
        )}>
          {selected && <div className="w-2 h-2 bg-primary-foreground rounded-full" />}
        </div>
        <div>
          <p className={cn("font-semibold text-sm", selected ? "text-foreground" : "")}>{label}</p>
          {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
        </div>
      </div>
    </button>
  );
}

// ─── Step Components ──────────────────────────────────────────────────────────

function StepGoal({ form, onChange }: { form: FormData; onChange: (k: keyof FormData, v: string) => void }) {
  const goals: { value: Goal; label: string; desc: string }[] = [
    { value: "build_muscle", label: "Build Muscle", desc: "Hypertrophy-focused training to maximize muscle growth" },
    { value: "lose_fat", label: "Lose Fat", desc: "Calorie-controlled plan to shed fat while preserving muscle" },
    { value: "recomp", label: "Body Recomposition", desc: "Simultaneously build muscle and lose fat" },
  ];
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Target className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h2 className="text-xl font-bold">What is your primary goal?</h2>
          <p className="text-sm text-muted-foreground">This shapes every aspect of your plan</p>
        </div>
      </div>
      <div className="space-y-3">
        {goals.map((g) => (
          <OptionButton
            key={g.value}
            value={g.value}
            selected={form.primaryGoal === g.value}
            onSelect={(v) => onChange("primaryGoal", v)}
            label={g.label}
            description={g.desc}
          />
        ))}
      </div>
    </div>
  );
}

function StepStats({ form, onChange }: { form: FormData; onChange: (k: keyof FormData, v: string) => void }) {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <User className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h2 className="text-xl font-bold">Your stats</h2>
          <p className="text-sm text-muted-foreground">Used to calculate accurate macro targets</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Current Weight (kg)</Label>
          <Input
            type="number"
            placeholder="e.g. 80"
            value={form.currentWeightKg}
            onChange={(e) => onChange("currentWeightKg", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Height (cm)</Label>
          <Input
            type="number"
            placeholder="e.g. 175"
            value={form.heightCm}
            onChange={(e) => onChange("heightCm", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Age</Label>
          <Input
            type="number"
            placeholder="e.g. 25"
            value={form.age}
            onChange={(e) => onChange("age", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Target Weight (kg) — optional</Label>
          <Input
            type="number"
            placeholder="e.g. 90"
            value={form.targetWeightKg}
            onChange={(e) => onChange("targetWeightKg", e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Sex</Label>
        <div className="grid grid-cols-3 gap-2">
          {(["male", "female", "other"] as Sex[]).map((s) => (
            <OptionButton
              key={s}
              value={s}
              selected={form.sex === s}
              onSelect={(v) => onChange("sex", v)}
              label={s.charAt(0).toUpperCase() + s.slice(1)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function StepTraining({ form, onChange }: { form: FormData; onChange: (k: keyof FormData, v: string) => void }) {
  const splits = ["Push/Pull/Legs", "Upper/Lower", "Full Body", "Bro Split", "Let AI decide"];
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Dumbbell className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h2 className="text-xl font-bold">Training setup</h2>
          <p className="text-sm text-muted-foreground">How you train determines your program structure</p>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Training Experience</Label>
        <div className="space-y-2">
          {([
            { value: "beginner", label: "Beginner", desc: "Less than 1 year of consistent training" },
            { value: "intermediate", label: "Intermediate", desc: "1–3 years, know the basics" },
            { value: "advanced", label: "Advanced", desc: "3+ years, trained consistently" },
          ] as const).map((e) => (
            <OptionButton
              key={e.value}
              value={e.value}
              selected={form.trainingExperience === e.value}
              onSelect={(v) => onChange("trainingExperience", v)}
              label={e.label}
              description={e.desc}
            />
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Training Days Per Week</Label>
        <div className="flex gap-2 flex-wrap">
          {[3, 4, 5, 6].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => onChange("trainingDaysPerWeek", String(d))}
              className={cn(
                "w-12 h-12 rounded-xl border-2 font-bold text-lg transition-all cursor-pointer",
                form.trainingDaysPerWeek === String(d)
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:border-primary/50"
              )}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Gym Access</Label>
        <div className="space-y-2">
          {([
            { value: "full_gym", label: "Full Gym", desc: "Barbells, machines, cables, full equipment" },
            { value: "home_gym", label: "Home Gym", desc: "Dumbbells, some equipment" },
            { value: "bodyweight", label: "Bodyweight Only", desc: "No equipment needed" },
          ] as const).map((g) => (
            <OptionButton
              key={g.value}
              value={g.value}
              selected={form.gymAccess === g.value}
              onSelect={(v) => onChange("gymAccess", v)}
              label={g.label}
              description={g.desc}
            />
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Preferred Workout Split — optional</Label>
        <div className="flex flex-wrap gap-2">
          {splits.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onChange("preferredSplit", form.preferredSplit === s ? "" : s)}
              className={cn(
                "px-3 py-1.5 rounded-full border text-xs font-medium transition-all cursor-pointer",
                form.preferredSplit === s
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:border-primary/50"
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function StepNutrition({ form, onChange }: { form: FormData; onChange: (k: keyof FormData, v: string) => void }) {
  const diets = ["Standard", "High Protein", "Vegetarian", "Vegan", "Keto / Low Carb", "Halal", "Kosher"];
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Utensils className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h2 className="text-xl font-bold">Nutrition preferences</h2>
          <p className="text-sm text-muted-foreground">Shapes your meal plan and food suggestions</p>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Dietary Preference</Label>
        <div className="flex flex-wrap gap-2">
          {diets.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => onChange("dietaryPreference", d)}
              className={cn(
                "px-3 py-2 rounded-xl border text-sm font-medium transition-all cursor-pointer",
                form.dietaryPreference === d
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:border-primary/50"
              )}
            >
              {d}
            </button>
          ))}
        </div>
        <Input
          placeholder="Or type your own (e.g. Pescatarian)"
          value={diets.includes(form.dietaryPreference) ? "" : form.dietaryPreference}
          onChange={(e) => onChange("dietaryPreference", e.target.value)}
          className="mt-2"
        />
      </div>

      <div className="space-y-1.5">
        <Label>Food Allergies or Restrictions — optional</Label>
        <Input
          placeholder="e.g. Lactose intolerant, no shellfish, nut allergy"
          value={form.allergiesRestrictions}
          onChange={(e) => onChange("allergiesRestrictions", e.target.value)}
        />
      </div>
    </div>
  );
}

// ─── Main Questionnaire ───────────────────────────────────────────────────────

const STEPS = [
  { id: "goal", label: "Goal" },
  { id: "stats", label: "Stats" },
  { id: "training", label: "Training" },
  { id: "nutrition", label: "Nutrition" },
];

function OnboardingQuestionnaire() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<FormData>({
    primaryGoal: "",
    currentWeightKg: "",
    heightCm: "",
    age: "",
    sex: "",
    trainingExperience: "",
    trainingDaysPerWeek: "4",
    gymAccess: "",
    dietaryPreference: "Standard",
    allergiesRestrictions: "",
    targetWeightKg: "",
    preferredSplit: "",
  });

  const saveOnboarding = useMutation(api.premiumOnboarding.saveOnboarding);

  const onChange = (key: keyof FormData, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const canProceed = () => {
    switch (step) {
      case 0: return form.primaryGoal !== "";
      case 1:
        return (
          form.currentWeightKg !== "" && parseFloat(form.currentWeightKg) > 0 &&
          form.heightCm !== "" && parseFloat(form.heightCm) > 0 &&
          form.age !== "" && parseInt(form.age) > 0 &&
          form.sex !== ""
        );
      case 2:
        return (
          form.trainingExperience !== "" &&
          form.trainingDaysPerWeek !== "" &&
          form.gymAccess !== ""
        );
      case 3:
        return form.dietaryPreference !== "";
      default:
        return false;
    }
  };

  const handleSubmit = async () => {
    if (!canProceed()) return;
    setSubmitting(true);
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
      });
      // Direct to initial check-in — required baseline before plan is revealed
      navigate("/check-in?initial=true");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const progress = ((step + 1) / STEPS.length) * 100;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="border-b border-border bg-card/50 px-4 py-4 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
          <Sparkles className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">
            GOAT WALK Premium Setup
          </p>
          <div className="flex items-center gap-3 mt-1">
            <Progress value={progress} className="h-1.5 flex-1" />
            <span className="text-xs text-muted-foreground shrink-0">
              {step + 1} / {STEPS.length}
            </span>
          </div>
        </div>
      </div>

      {/* Step tabs */}
      <div className="flex border-b border-border overflow-x-auto">
        {STEPS.map((s, i) => (
          <button
            key={s.id}
            type="button"
            disabled={i > step}
            onClick={() => { if (i <= step) setStep(i); }}
            className={cn(
              "px-4 py-2 text-xs font-medium uppercase tracking-wider border-b-2 shrink-0 transition-all",
              i === step
                ? "border-primary text-foreground"
                : i < step
                  ? "border-transparent text-primary cursor-pointer"
                  : "border-transparent text-muted-foreground/40 cursor-not-allowed"
            )}
          >
            {i < step && <CheckCircle2 className="w-3 h-3 inline mr-1 text-primary" />}
            {s.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-xl mx-auto px-4 py-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
            >
              <Card className="bg-card border-border">
                <CardContent className="p-6">
                  {step === 0 && <StepGoal form={form} onChange={onChange} />}
                  {step === 1 && <StepStats form={form} onChange={onChange} />}
                  {step === 2 && <StepTraining form={form} onChange={onChange} />}
                  {step === 3 && <StepNutrition form={form} onChange={onChange} />}
                </CardContent>
              </Card>
            </motion.div>
          </AnimatePresence>

          {/* Nav buttons */}
          <div className="flex items-center justify-between mt-6 gap-3">
            <Button
              variant="ghost"
              onClick={() => setStep((s) => s - 1)}
              disabled={step === 0}
              className="cursor-pointer gap-1.5"
            >
              <ChevronLeft className="w-4 h-4" />
              Back
            </Button>

            {step < STEPS.length - 1 ? (
              <Button
                onClick={() => setStep((s) => s + 1)}
                disabled={!canProceed()}
                className="cursor-pointer gap-1.5"
              >
                Continue
                <ChevronRight className="w-4 h-4" />
              </Button>
            ) : (
              <Button
                onClick={handleSubmit}
                disabled={!canProceed() || submitting}
                className="cursor-pointer gap-2 min-w-[160px]"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Generating Plan...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Generate My Plan
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Gate: check if user has already completed onboarding ────────────────────

function OnboardingGateContent() {
  const navigate = useNavigate();
  const currentUser = useQuery(api.users.getCurrentUser, {});
  const onboarding = useQuery(api.premiumOnboarding.getMyOnboarding, {});
  const onboardingStatus = useQuery(api.weeklyCheckIns.getOnboardingStatus, {});

  // #16 — Sync subscription status after a successful Commerce checkout.
  // The checkout successUrl redirects to /onboarding with ?success=1.
  // We call syncSubscriptionStatus once so `users.subscriptionTier` is updated
  // in the DB before the user hits any premium-gated feature.
  const syncSubscription = useAction(api.commerce.subscriptions.syncSubscriptionStatus);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("success") === "1") {
      void syncSubscription({}).catch(() => {
        // Non-fatal — the user will still land in the app.
        // Backend premium checks always re-verify via Commerce so they remain safe.
      });
      // Remove the query param so a page refresh doesn't re-trigger
      const url = new URL(window.location.href);
      url.searchParams.delete("success");
      window.history.replaceState({}, "", url.toString());
    }
  // Run once on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (currentUser === undefined || onboarding === undefined || onboardingStatus === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="space-y-4 text-center">
          <Skeleton className="w-20 h-20 rounded-2xl mx-auto" />
          <Skeleton className="w-48 h-5 mx-auto" />
          <Skeleton className="w-64 h-4 mx-auto" />
        </div>
      </div>
    );
  }

  // If already completed onboarding but no initial check-in, send there
  if (onboarding && !onboardingStatus?.hasInitialCheckIn) {
    navigate("/check-in?initial=true");
    return null;
  }

  // If fully completed, redirect to dashboard
  if (onboarding) {
    navigate("/dashboard");
    return null;
  }

  return <OnboardingQuestionnaire />;
}

export default function PremiumOnboardingPage() {
  return (
    <Authenticated>
      <OnboardingGateContent />
    </Authenticated>
  );
}
