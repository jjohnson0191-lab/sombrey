import { useState, useEffect, useCallback, useRef } from "react";
import { Authenticated } from "convex/react";
import { useQuery, useAction } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty.tsx";
import { Dumbbell, Search, Plus, PlayCircle, Download, Check } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge.tsx";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet.tsx";
import { toast } from "sonner";
import { useDebounce } from "@/hooks/use-debounce.ts";

const muscleGroups = [
  { value: "all", label: "All" },
  { value: "chest", label: "Chest" },
  { value: "back", label: "Back" },
  { value: "shoulders", label: "Shoulders" },
  { value: "arms", label: "Arms" },
  { value: "legs", label: "Legs" },
  { value: "core", label: "Core" },
  { value: "cardio", label: "Cardio" },
] as const;

const programPhases = [
  { value: "all", label: "All Phases" },
  { value: "metabolic_rewire", label: "Metabolic Rewire™" },
  { value: "anabolic_surge", label: "Anabolic Surge Protocol™" },
  { value: "body_recode", label: "Body Recode™" },
] as const;

// ── WorkoutX Coach Import Panel ───────────────────────────────────────────────
// (Unchanged — still available for coaches to manually add specific exercises)

type WxResult = {
  id: string;
  name: string;
  bodyPart: string;
  target: string;
  secondaryMuscles: string[];
  equipment: string;
  gifUrl: string;
  instructions: string[];
};

type ImportState = "idle" | "importing" | "imported";

function WxImportPanel() {
  const [query, setQuery] = useState("");
  const [bodyPart, setBodyPart] = useState("");
  const [results, setResults] = useState<WxResult[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [importStates, setImportStates] = useState<Record<string, ImportState>>({});

  const searchWx = useAction(api.workoutx.searchExercises);
  const importWx = useAction(api.workoutx.importExercise);

  const handleSearch = useCallback(async () => {
    if (!query.trim() && !bodyPart.trim()) {
      toast.error("Enter a search term or select a body part");
      return;
    }
    setIsSearching(true);
    setResults(null);
    try {
      const data = await searchWx({
        query: query.trim() || undefined,
        bodyPart: bodyPart.trim() || undefined,
        limit: 30,
      });
      setResults(data);
      if (data.length === 0) toast.info("No exercises found — try a different search");
    } catch {
      toast.error("Search failed. Check your WorkoutX API key in Secrets.");
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [query, bodyPart, searchWx]);

  const handleImport = async (exercise: WxResult) => {
    setImportStates((s) => ({ ...s, [exercise.id]: "importing" }));
    try {
      await importWx({ workoutxId: exercise.id });
      setImportStates((s) => ({ ...s, [exercise.id]: "imported" }));
      toast.success(`"${exercise.name}" added to your exercise library`);
    } catch {
      toast.error(`Failed to import "${exercise.name}"`);
      setImportStates((s) => ({ ...s, [exercise.id]: "idle" }));
    }
  };

  const bodyParts = [
    "back", "cardio", "chest", "lower arms", "lower legs",
    "neck", "shoulders", "upper arms", "upper legs", "waist",
  ];

  return (
    <div className="flex flex-col gap-4 h-full overflow-y-auto pb-6">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search exercises…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void handleSearch()}
            className="pl-9"
          />
        </div>
        <Button onClick={() => void handleSearch()} disabled={isSearching} size="sm" className="cursor-pointer">
          {isSearching ? "…" : "Search"}
        </Button>
      </div>
      <div>
        <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Browse by Body Part</p>
        <div className="flex flex-wrap gap-1.5">
          {bodyParts.map((bp) => (
            <button
              key={bp}
              onClick={() => {
                const next = bp === bodyPart ? "" : bp;
                setBodyPart(next);
                setQuery("");
                if (next) {
                  setIsSearching(true);
                  setResults(null);
                  searchWx({ bodyPart: next, limit: 30 })
                    .then((data) => setResults(data))
                    .catch(() => toast.error("Search failed"))
                    .finally(() => setIsSearching(false));
                }
              }}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors cursor-pointer capitalize ${
                bodyPart === bp
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted/30 text-muted-foreground border-border hover:border-primary/40"
              }`}
            >
              {bp}
            </button>
          ))}
        </div>
      </div>
      {isSearching && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      )}
      {!isSearching && results !== null && results.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-6">No exercises found — try a different term</p>
      )}
      {!isSearching && results !== null && results.length > 0 && (
        <div className="space-y-2">
          {results.map((ex) => {
            const state = importStates[ex.id] ?? "idle";
            return (
              <div key={ex.id} className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card/50 hover:border-primary/30 transition-colors">
                <div className="w-14 h-14 shrink-0 rounded-md overflow-hidden bg-muted flex items-center justify-center">
                  {ex.gifUrl ? (
                    <img src={ex.gifUrl} alt={ex.name} className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <Dumbbell className="w-5 h-5 text-muted-foreground/40" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{ex.name}</p>
                  <div className="flex gap-1 mt-0.5 flex-wrap">
                    <Badge variant="secondary" className="text-[10px] capitalize">{ex.bodyPart}</Badge>
                    {ex.target && <Badge variant="outline" className="text-[10px] capitalize">{ex.target}</Badge>}
                  </div>
                </div>
                {state === "imported" ? (
                  <div className="flex items-center gap-1 text-xs text-green-500 shrink-0">
                    <Check className="w-3.5 h-3.5" />
                    Added
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="shrink-0 cursor-pointer h-7 text-xs"
                    disabled={state === "importing"}
                    onClick={() => void handleImport(ex)}
                  >
                    {state === "importing" ? "…" : (
                      <><Download className="w-3 h-3 mr-1" />Add</>
                    )}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {results === null && !isSearching && (
        <div className="text-center py-10 text-muted-foreground">
          <Dumbbell className="w-10 h-10 mx-auto mb-2 opacity-20" />
          <p className="text-xs">Search or select a body part to find exercises</p>
        </div>
      )}
    </div>
  );
}

// ── Lazy-sync hook ────────────────────────────────────────────────────────────

/**
 * Calls api.workoutx.syncAndSearch on filter changes.
 * On a cache miss, WorkoutX results are upserted into Convex.
 * On a cache hit, no API call is made.
 * Either way, useQuery(api.exercises.list) picks up new exercises reactively.
 */
function useWxSync(searchTerm: string, muscleGroup: string) {
  const syncAndSearch = useAction(api.workoutx.syncAndSearch);
  // Track which keys we've already synced this session to avoid redundant calls
  const syncedRef = useRef<Set<string>>(new Set());
  const [isSyncing, setIsSyncing] = useState(false);

  const [debouncedSearch] = useDebounce(searchTerm, 600);

  useEffect(() => {
    const term = debouncedSearch.trim();
    // Build a session-level key identical to the server-side cacheKey logic
    let sessionKey: string;
    if (term.length >= 2) {
      sessionKey = `name:${term.toLowerCase()}`;
    } else if (muscleGroup && muscleGroup !== "all") {
      const BP_MAP: Record<string, string> = {
        chest: "chest", back: "back", shoulders: "shoulders",
        arms: "upper arms", legs: "upper legs", core: "waist", cardio: "cardio",
      };
      sessionKey = `bodyPart:${BP_MAP[muscleGroup] ?? muscleGroup}`;
    } else {
      sessionKey = "bodyPart:back";
    }

    // Already synced this session — skip (server cache will also catch it)
    if (syncedRef.current.has(sessionKey)) return;

    setIsSyncing(true);
    syncAndSearch({ searchTerm: term.length >= 2 ? term : undefined, muscleGroup })
      .then(() => {
        syncedRef.current.add(sessionKey);
      })
      .catch(() => {
        // Silently degrade — Convex data still shows without WX enrichment
      })
      .finally(() => setIsSyncing(false));
  }, [debouncedSearch, muscleGroup, syncAndSearch]);

  return { isSyncing };
}

// ── Main Library ──────────────────────────────────────────────────────────────

function ExerciseLibraryContent() {
  const [selectedMuscleGroup, setSelectedMuscleGroup] = useState<string>("all");
  const [selectedPhase, setSelectedPhase] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [importPanelOpen, setImportPanelOpen] = useState(false);

  type MuscleGroup = "chest" | "back" | "shoulders" | "arms" | "legs" | "core" | "cardio";
  type ProgramPhase = "metabolic_rewire" | "anabolic_surge" | "body_recode";

  // Lazily sync WorkoutX data for the current filter/search in the background
  const { isSyncing } = useWxSync(searchTerm, selectedMuscleGroup);

  // This is the single reactive source of truth — includes both local + WX exercises
  const exercises = useQuery(api.exercises.list, {
    muscleGroup: selectedMuscleGroup !== "all" ? selectedMuscleGroup as MuscleGroup : undefined,
    programPhase: selectedPhase !== "all" ? selectedPhase as ProgramPhase : undefined,
    searchTerm: searchTerm || undefined,
  });

  const currentUser = useQuery(api.users.getCurrentUser);
  const isCoachOrAdmin =
    currentUser?.effectiveRoles?.includes("coach") ||
    currentUser?.effectiveRoles?.includes("admin") ||
    currentUser?.effectiveRoles?.includes("owner") ||
    false;

  const isLoading = exercises === undefined;

  return (
    <div className="space-y-6">
      {/* Search + action buttons */}
      <div className="flex flex-col lg:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search exercises..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        {isCoachOrAdmin && (
          <div className="flex gap-2">
            <Sheet open={importPanelOpen} onOpenChange={setImportPanelOpen}>
              <SheetTrigger asChild>
                <Button variant="secondary" className="cursor-pointer">
                  <Download className="w-4 h-4 mr-2" />
                  Import Exercise
                </Button>
              </SheetTrigger>
              <SheetContent className="w-full sm:max-w-md flex flex-col gap-4">
                <SheetHeader>
                  <SheetTitle>Import Exercise</SheetTitle>
                  <p className="text-sm text-muted-foreground">
                    Search the exercise database and add exercises to your library.
                  </p>
                </SheetHeader>
                <WxImportPanel />
              </SheetContent>
            </Sheet>
            <Button asChild className="cursor-pointer">
              <Link to="/exercises/new">
                <Plus className="w-4 h-4 mr-2" />
                Add Exercise
              </Link>
            </Button>
          </div>
        )}
      </div>

      {/* Muscle Group Filters */}
      <div>
        <h3 className="text-sm font-semibold mb-3 text-muted-foreground">Muscle Group</h3>
        <div className="flex flex-wrap gap-2">
          {muscleGroups.map((group) => (
            <Button
              key={group.value}
              variant={selectedMuscleGroup === group.value ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedMuscleGroup(group.value)}
            >
              {group.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Program Phase Filters */}
      <div>
        <h3 className="text-sm font-semibold mb-3 text-muted-foreground">Program Phase</h3>
        <div className="flex flex-wrap gap-2">
          {programPhases.map((phase) => (
            <Button
              key={phase.value}
              variant={selectedPhase === phase.value ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedPhase(phase.value)}
            >
              {phase.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Exercise Grid — shows a brief loading state while syncing on first visit */}
      {isLoading || (isSyncing && exercises !== undefined && exercises.length === 0) ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-64 w-full" />
          ))}
        </div>
      ) : exercises.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><Dumbbell /></EmptyMedia>
            <EmptyTitle>No exercises found</EmptyTitle>
            <EmptyDescription>
              {isCoachOrAdmin
                ? "Add your first exercise or use Import Exercise to bring in exercises from the database"
                : "No exercises match your current filters"}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {exercises.map((exercise) => (
            <Link key={exercise._id} to={`/exercises/${exercise._id}`}>
              <Card className="h-full bg-card/50 backdrop-blur border-border hover:border-primary/50 transition-all cursor-pointer group">
                <CardHeader className="pb-3">
                  <div className="w-full aspect-video bg-muted rounded-lg mb-3 flex items-center justify-center overflow-hidden group-hover:bg-muted/70 transition-colors">
                    {exercise.gifUrl ? (
                      <img
                        src={exercise.gifUrl}
                        alt={exercise.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : exercise.videoUrl ? (
                      <video
                        src={exercise.videoUrl}
                        className="w-full h-full object-cover"
                        preload="metadata"
                        muted
                      />
                    ) : (
                      <PlayCircle className="w-12 h-12 text-muted-foreground/40" />
                    )}
                  </div>
                  <CardTitle className="text-lg line-clamp-1">{exercise.name}</CardTitle>
                  <CardDescription className="line-clamp-2">{exercise.description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex flex-wrap gap-1">
                    <Badge variant="secondary" className="text-xs">
                      {exercise.muscleGroup.charAt(0).toUpperCase() + exercise.muscleGroup.slice(1)}
                    </Badge>
                    {exercise.programPhase && (
                      <Badge variant="outline" className="text-xs">
                        {exercise.programPhase.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                      </Badge>
                    )}
                  </div>
                  {exercise.equipment.length > 0 && (
                    <div className="text-xs text-muted-foreground">
                      {exercise.equipment.join(", ")}
                    </div>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ExercisesPage() {
  return (
    <Authenticated>
      <div className="max-w-2xl mx-auto px-4 pt-6 pb-4">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">
            Exercise Library
          </h1>
          <p className="text-muted-foreground text-lg">
            HD demonstrations organized by muscle group
          </p>
        </div>
        <ExerciseLibraryContent />
      </div>
    </Authenticated>
  );
}
