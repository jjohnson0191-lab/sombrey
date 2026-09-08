import type { Id } from "@/convex/_generated/dataModel.js";

type IntensifierType = "superset" | "dropset" | "tempo" | "rpe" | "suggested_weight";

type DropSubSet = {
  subSetNumber: number;
  weightKg: string;
  reps: string;
  restSeconds: string;
};

type SetConfig = {
  setNumber: number;
  reps: string;
  weightKg: string;
  restSeconds: string;
  intensifierType: IntensifierType | "";
  intensifierValue: string;
  supersetExerciseId: Id<"exercises"> | "";
  dropSubSets: DropSubSet[];
  notes: string;
  showDetails: boolean;
};

type ExerciseEntry = {
  exerciseId: Id<"exercises">;
  exerciseName: string;
  sets: number;
  reps: string;
  restSeconds: number;
  notes: string;
  isDropSet: boolean;
  tempo: string;
  suggestedWeightKg: string;
  rpe: string;
  supersetWith: Id<"exercises"> | "";
  supersetName: string;
  setConfigs: SetConfig[];
  showExerciseSettings: boolean;
  useSetLevel: boolean;
};

type BackendSetConfig = {
  setNumber: number;
  reps?: number | string;
  weightKg?: number;
  restSeconds?: number;
  intensifierType?: IntensifierType;
  intensifierValue?: string;
  supersetExerciseId?: Id<"exercises">;
  dropSubSets?: Array<{
    subSetNumber: number;
    weightKg?: number;
    reps?: number;
    restSeconds?: number;
  }>;
  notes?: string;
};

function backendSetConfigToFormSetConfig(sc: BackendSetConfig): SetConfig {
  return {
    setNumber: sc.setNumber,
    reps: sc.reps != null ? String(sc.reps) : "10",
    weightKg: sc.weightKg != null ? String(sc.weightKg) : "",
    restSeconds: sc.restSeconds != null ? String(sc.restSeconds) : "60",
    intensifierType: sc.intensifierType ?? "",
    intensifierValue: sc.intensifierValue ?? "",
    supersetExerciseId: sc.supersetExerciseId ?? "",
    dropSubSets: (sc.dropSubSets ?? []).map((ds) => ({
      subSetNumber: ds.subSetNumber,
      weightKg: ds.weightKg != null ? String(ds.weightKg) : "",
      reps: ds.reps != null ? String(ds.reps) : "",
      restSeconds: ds.restSeconds != null ? String(ds.restSeconds) : "",
    })),
    notes: sc.notes ?? "",
    showDetails: !!(sc.intensifierType || sc.notes),
  };
}

// Generate set configs from legacy flat fields
function buildFallbackSetConfigs(
  sets: number,
  reps: number | string,
  restSeconds: number,
  isDropSet: boolean,
  rpe: number | undefined,
  suggestedWeightKg: number | undefined,
  tempo: string | undefined,
  supersetWith: Id<"exercises"> | undefined,
): SetConfig[] {
  return Array.from({ length: sets }, (_, i) => {
    let intensifierType: IntensifierType | "" = "";
    let intensifierValue = "";
    if (isDropSet) intensifierType = "dropset";
    else if (supersetWith) intensifierType = "superset";
    else if (rpe) { intensifierType = "rpe"; intensifierValue = String(rpe); }
    else if (suggestedWeightKg) { intensifierType = "suggested_weight"; intensifierValue = String(suggestedWeightKg); }
    else if (tempo) { intensifierType = "tempo"; intensifierValue = tempo; }

    return {
      setNumber: i + 1,
      reps: String(reps),
      weightKg: suggestedWeightKg != null ? String(suggestedWeightKg) : "",
      restSeconds: String(restSeconds),
      intensifierType,
      intensifierValue,
      supersetExerciseId: supersetWith ?? "",
      dropSubSets: [],
      notes: "",
      showDetails: false,
    };
  });
}

export function backendExerciseToEntry(
  ex: {
    exerciseId: Id<"exercises">;
    exerciseName: string;
    sets: number;
    reps: number | string;
    restSeconds: number;
    notes?: string;
    isDropSet?: boolean;
    tempo?: string;
    suggestedWeightKg?: number;
    rpe?: number;
    supersetWith?: Id<"exercises">;
    supersetName?: string;
    setConfigs?: BackendSetConfig[];
  },
): ExerciseEntry {
  const hasSetConfigs = ex.setConfigs && ex.setConfigs.length > 0;
  const setConfigs = hasSetConfigs
    ? ex.setConfigs!.map(backendSetConfigToFormSetConfig)
    : buildFallbackSetConfigs(
        ex.sets,
        ex.reps,
        ex.restSeconds,
        ex.isDropSet ?? false,
        ex.rpe,
        ex.suggestedWeightKg,
        ex.tempo,
        ex.supersetWith,
      );

  return {
    exerciseId: ex.exerciseId,
    exerciseName: ex.exerciseName,
    sets: ex.sets,
    reps: String(ex.reps),
    restSeconds: ex.restSeconds,
    notes: ex.notes ?? "",
    isDropSet: ex.isDropSet ?? false,
    tempo: ex.tempo ?? "",
    suggestedWeightKg: ex.suggestedWeightKg != null ? String(ex.suggestedWeightKg) : "",
    rpe: ex.rpe != null ? String(ex.rpe) : "",
    supersetWith: ex.supersetWith ?? "",
    supersetName: ex.supersetName ?? "",
    setConfigs,
    showExerciseSettings: !!ex.notes,
    useSetLevel: true,
  };
}
