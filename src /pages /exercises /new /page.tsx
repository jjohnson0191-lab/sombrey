import { useState } from "react";
import { Authenticated } from "convex/react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { ArrowLeft, Plus, X } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge.tsx";
import VideoUpload from "../_components/video-upload.tsx";

function AddExerciseForm() {
  const navigate = useNavigate();
  const createExercise = useMutation(api.exercises.create);
  const currentUser = useQuery(api.users.getCurrentUser);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [muscleGroup, setMuscleGroup] = useState<string>("");
  const [programPhase, setProgramPhase] = useState<string>("");
  const [equipmentInput, setEquipmentInput] = useState("");
  const [equipment, setEquipment] = useState<string[]>([]);
  const [primaryMuscleInput, setPrimaryMuscleInput] = useState("");
  const [primaryMuscles, setPrimaryMuscles] = useState<string[]>([]);
  const [secondaryMuscleInput, setSecondaryMuscleInput] = useState("");
  const [secondaryMuscles, setSecondaryMuscles] = useState<string[]>([]);
  const [instructionInput, setInstructionInput] = useState("");
  const [instructions, setInstructions] = useState<string[]>([]);
  const [cueInput, setCueInput] = useState("");
  const [cues, setCues] = useState<string[]>([]);
  const [safetyNotes, setSafetyNotes] = useState("");
  const [pendingStorageId, setPendingStorageId] = useState<Id<"_storage"> | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isCoachOrAdmin =
    currentUser?.effectiveRoles?.includes("coach") ||
    currentUser?.effectiveRoles?.includes("admin") ||
    currentUser?.effectiveRoles?.includes("owner") ||
    false;

  if (!isCoachOrAdmin) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Only coaches and admins can add exercises</p>
        <Button asChild className="mt-4">
          <Link to="/exercises">Back to Library</Link>
        </Button>
      </div>
    );
  }

  const addItem = (value: string, setter: (items: string[]) => void, items: string[]) => {
    if (value.trim()) setter([...items, value.trim()]);
  };

  const removeItem = (index: number, setter: (items: string[]) => void, items: string[]) => {
    setter(items.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!muscleGroup) { toast.error("Please select a muscle group"); return; }
    if (primaryMuscles.length === 0) { toast.error("Please add at least one primary muscle"); return; }
    if (instructions.length === 0) { toast.error("Please add at least one instruction"); return; }
    if (cues.length === 0) { toast.error("Please add at least one coaching cue"); return; }

    setIsSubmitting(true);
    try {
      type MuscleGroup = "chest" | "back" | "shoulders" | "arms" | "legs" | "core" | "cardio";
      type ProgramPhase = "metabolic_rewire" | "anabolic_surge" | "body_recode";

      const exerciseId = await createExercise({
        name,
        description,
        muscleGroup: muscleGroup as MuscleGroup,
        programPhase: programPhase && programPhase !== "none" ? programPhase as ProgramPhase : undefined,
        equipment,
        primaryMuscles,
        secondaryMuscles,
        instructions,
        cues,
        safetyNotes: safetyNotes || undefined,
        storageId: pendingStorageId ?? undefined,
      });

      toast.success("Exercise created successfully!");
      navigate(`/exercises/${exerciseId}`);
    } catch {
      toast.error("Failed to create exercise");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card className="bg-card/50 backdrop-blur border-border">
        <CardHeader>
          <CardTitle>Basic Information</CardTitle>
          <CardDescription>Essential details about the exercise</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Exercise Name *</Label>
            <Input id="name" placeholder="Barbell Bench Press" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description *</Label>
            <Textarea id="description" placeholder="A compound upper body exercise targeting the chest..." value={description} onChange={(e) => setDescription(e.target.value)} rows={3} required />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="muscleGroup">Muscle Group *</Label>
              <Select value={muscleGroup} onValueChange={setMuscleGroup}>
                <SelectTrigger id="muscleGroup" className="cursor-pointer">
                  <SelectValue placeholder="Select muscle group" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="chest">Chest</SelectItem>
                  <SelectItem value="back">Back</SelectItem>
                  <SelectItem value="shoulders">Shoulders</SelectItem>
                  <SelectItem value="arms">Arms</SelectItem>
                  <SelectItem value="legs">Legs</SelectItem>
                  <SelectItem value="core">Core</SelectItem>
                  <SelectItem value="cardio">Cardio</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="programPhase">Program Phase (Optional)</Label>
              <Select value={programPhase} onValueChange={setProgramPhase}>
                <SelectTrigger id="programPhase" className="cursor-pointer">
                  <SelectValue placeholder="Select phase" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="metabolic_rewire">Metabolic Rewire™</SelectItem>
                  <SelectItem value="anabolic_surge">Anabolic Surge Protocol™</SelectItem>
                  <SelectItem value="body_recode">Body Recode™</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Video Upload */}
      <Card className="bg-card/50 backdrop-blur border-border">
        <CardHeader>
          <CardTitle>Video Demonstration</CardTitle>
          <CardDescription>Upload an optional video to demonstrate the exercise. You can also add one later.</CardDescription>
        </CardHeader>
        <CardContent>
          <VideoUpload
            onUploaded={(storageId) => setPendingStorageId(storageId)}
          />
          {pendingStorageId && (
            <p className="text-xs text-green-400 mt-2">
              ✓ Video staged — will be saved when you create the exercise
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="bg-card/50 backdrop-blur border-border">
        <CardHeader>
          <CardTitle>Equipment & Muscles</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Equipment */}
          <div className="space-y-2">
            <Label htmlFor="equipment">Equipment</Label>
            <div className="flex gap-2">
              <Input id="equipment" placeholder="Barbell, Bench" value={equipmentInput} onChange={(e) => setEquipmentInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addItem(equipmentInput, setEquipment, equipment); setEquipmentInput(""); } }} />
              <Button type="button" onClick={() => { addItem(equipmentInput, setEquipment, equipment); setEquipmentInput(""); }}>
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              {equipment.map((item, i) => (
                <Badge key={i} variant="secondary" className="gap-1">{item}
                  <button type="button" onClick={() => removeItem(i, setEquipment, equipment)} className="ml-1 hover:text-destructive"><X className="w-3 h-3" /></button>
                </Badge>
              ))}
            </div>
          </div>

          {/* Primary Muscles */}
          <div className="space-y-2">
            <Label htmlFor="primaryMuscles">Primary Muscles *</Label>
            <div className="flex gap-2">
              <Input id="primaryMuscles" placeholder="Pectoralis Major" value={primaryMuscleInput} onChange={(e) => setPrimaryMuscleInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addItem(primaryMuscleInput, setPrimaryMuscles, primaryMuscles); setPrimaryMuscleInput(""); } }} />
              <Button type="button" onClick={() => { addItem(primaryMuscleInput, setPrimaryMuscles, primaryMuscles); setPrimaryMuscleInput(""); }}>
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              {primaryMuscles.map((item, i) => (
                <Badge key={i} variant="default" className="gap-1">{item}
                  <button type="button" onClick={() => removeItem(i, setPrimaryMuscles, primaryMuscles)} className="ml-1 hover:text-destructive"><X className="w-3 h-3" /></button>
                </Badge>
              ))}
            </div>
          </div>

          {/* Secondary Muscles */}
          <div className="space-y-2">
            <Label htmlFor="secondaryMuscles">Secondary Muscles</Label>
            <div className="flex gap-2">
              <Input id="secondaryMuscles" placeholder="Anterior Deltoid" value={secondaryMuscleInput} onChange={(e) => setSecondaryMuscleInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addItem(secondaryMuscleInput, setSecondaryMuscles, secondaryMuscles); setSecondaryMuscleInput(""); } }} />
              <Button type="button" onClick={() => { addItem(secondaryMuscleInput, setSecondaryMuscles, secondaryMuscles); setSecondaryMuscleInput(""); }}>
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              {secondaryMuscles.map((item, i) => (
                <Badge key={i} variant="outline" className="gap-1">{item}
                  <button type="button" onClick={() => removeItem(i, setSecondaryMuscles, secondaryMuscles)} className="ml-1 hover:text-destructive"><X className="w-3 h-3" /></button>
                </Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/50 backdrop-blur border-border">
        <CardHeader>
          <CardTitle>Instructions & Cues</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Instructions */}
          <div className="space-y-2">
            <Label htmlFor="instructions">Step-by-Step Instructions *</Label>
            <div className="flex gap-2">
              <Textarea id="instructions" placeholder="Lie flat on the bench with feet firmly on the ground..." value={instructionInput} onChange={(e) => setInstructionInput(e.target.value)} rows={2} />
              <Button type="button" onClick={() => { addItem(instructionInput, setInstructions, instructions); setInstructionInput(""); }}><Plus className="w-4 h-4" /></Button>
            </div>
            <div className="space-y-2 mt-2">
              {instructions.map((item, i) => (
                <div key={i} className="flex gap-2 items-start p-3 bg-muted rounded-lg">
                  <span className="font-bold text-primary">{i + 1}.</span>
                  <span className="flex-1">{item}</span>
                  <button type="button" onClick={() => removeItem(i, setInstructions, instructions)} className="text-muted-foreground hover:text-destructive"><X className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          </div>

          {/* Cues */}
          <div className="space-y-2">
            <Label htmlFor="cues">Coaching Cues *</Label>
            <div className="flex gap-2">
              <Input id="cues" placeholder="Keep your core tight throughout the movement" value={cueInput} onChange={(e) => setCueInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addItem(cueInput, setCues, cues); setCueInput(""); } }} />
              <Button type="button" onClick={() => { addItem(cueInput, setCues, cues); setCueInput(""); }}><Plus className="w-4 h-4" /></Button>
            </div>
            <div className="space-y-2 mt-2">
              {cues.map((item, i) => (
                <div key={i} className="flex gap-2 items-center p-2 bg-primary/10 rounded-lg">
                  <span className="text-primary">•</span>
                  <span className="flex-1">{item}</span>
                  <button type="button" onClick={() => removeItem(i, setCues, cues)} className="text-muted-foreground hover:text-destructive"><X className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          </div>

          {/* Safety Notes */}
          <div className="space-y-2">
            <Label htmlFor="safetyNotes">Safety Notes (Optional)</Label>
            <Textarea id="safetyNotes" placeholder="Avoid locking out elbows completely. Stop if you feel shoulder pain..." value={safetyNotes} onChange={(e) => setSafetyNotes(e.target.value)} rows={3} />
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-4">
        <Button type="submit" size="lg" disabled={isSubmitting}>
          {isSubmitting ? "Creating..." : "Create Exercise"}
        </Button>
        <Button type="button" variant="secondary" size="lg" asChild>
          <Link to="/exercises">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}

export default function NewExercisePage() {
  return (
    <Authenticated>
      <div className="max-w-2xl mx-auto px-4 pt-6 pb-4">
        <div className="mb-6">
          <Button variant="secondary" size="sm" asChild className="mb-4">
            <Link to="/exercises">
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to Library
            </Link>
          </Button>
          <h1 className="text-4xl font-bold mb-2">Add New Exercise</h1>
          <p className="text-muted-foreground text-lg">
            Create a new exercise with detailed instructions and coaching cues
          </p>
        </div>
        <AddExerciseForm />
      </div>
    </Authenticated>
  );
}
