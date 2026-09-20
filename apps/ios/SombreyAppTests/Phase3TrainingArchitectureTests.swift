import Testing
@testable import SombreyApp

/// Sport+ catalog — generated from the real vendor header
/// (OdmSportPlusModels.h). These guard against the generator silently
/// producing something wrong, not against the header itself changing.
struct SombreySportTypeTests {
    @Test func catalogHasNoDuplicateRawValues() {
        let rawValues = SombreySportType.all.map(\.rawValue)
        #expect(Set(rawValues).count == rawValues.count)
    }

    @Test func catalogIncludesEveryExplicitlyRequestedMode() {
        // Raw values per the real header — running(1/7), walking(3/4),
        // cycling(2/9), swimming(6), strength training(88).
        let raw = Set(SombreySportType.all.map(\.rawValue))
        #expect(raw.contains(1))   // GPS Run
        #expect(raw.contains(7))   // Run
        #expect(raw.contains(3))   // GPS Walk
        #expect(raw.contains(2))   // GPS Bike
        #expect(raw.contains(51))  // Indoor Cycling
        #expect(raw.contains(6))   // Swimming
        #expect(raw.contains(88))  // Strength Training
    }

    @Test func byRawValueLookupMatchesAll() {
        for entry in SombreySportType.all {
            #expect(SombreySportType.byRawValue[entry.rawValue]?.id == entry.id)
        }
    }

    @Test func gpsFlaggedTypesAreARealSubset() {
        let gpsTypes = SombreySportType.all.filter(\.usesPhoneGPS)
        #expect(!gpsTypes.isEmpty)
        #expect(gpsTypes.count < SombreySportType.all.count)
    }
}

/// `OnDemandMetric` -> `QCMeasuringType` raw-value mapping (QCSDKManager.h):
/// HeartRate=0, BloodPressue=1, BloodOxygen=2, BodyTemperature=7.
struct OnDemandMetricTests {
    @Test func rawValuesMatchTheVendorHeader() {
        #expect(OnDemandMetric.heartRate.qcRawValue == 0)
        #expect(OnDemandMetric.bloodPressure.qcRawValue == 1)
        #expect(OnDemandMetric.spo2.qcRawValue == 2)
        #expect(OnDemandMetric.bodyTemperature.qcRawValue == 7)
    }
}

/// `TrainingSessionManager` state transitions that don't touch Convex —
/// matching `WearableManagerTests`' own discipline of only exercising
/// what's testable without a live session/network.
@MainActor
struct TrainingSessionManagerTests {
    private static let squat = Exercise(id: "ex1", name: "Squat", description: "", muscleGroup: "legs")
    private static let bench = Exercise(id: "ex2", name: "Bench Press", description: "", muscleGroup: "chest")
    private static let row = Exercise(id: "ex3", name: "Row", description: "", muscleGroup: "back")

    @Test func toggleAddsAndRemovesExercises() {
        let session = TrainingSessionManager()
        session.toggle(Self.squat)
        #expect(session.selectedExercises == [Self.squat])
        session.toggle(Self.squat)
        #expect(session.selectedExercises.isEmpty)
    }

    @Test func moveExerciseReorders() {
        let session = TrainingSessionManager()
        session.toggle(Self.squat)
        session.toggle(Self.bench)
        session.toggle(Self.row)
        session.moveExercise(fromOffsets: IndexSet(integer: 2), toOffset: 0)
        #expect(session.selectedExercises == [Self.row, Self.squat, Self.bench])
    }

    @Test func addExerciseDuringWorkoutInsertsAfterCurrent() {
        let session = TrainingSessionManager()
        session.selectedExercises = [Self.squat, Self.bench]
        session.addExerciseDuringWorkout(Self.row)
        #expect(session.selectedExercises == [Self.squat, Self.row, Self.bench])
    }

    @Test func addExerciseDuringWorkoutIgnoresDuplicates() {
        let session = TrainingSessionManager()
        session.selectedExercises = [Self.squat, Self.bench]
        session.addExerciseDuringWorkout(Self.squat)
        #expect(session.selectedExercises == [Self.squat, Self.bench])
    }

    @Test func skipCurrentExerciseAdvancesWithoutFinishing() {
        let session = TrainingSessionManager()
        session.selectedExercises = [Self.squat, Self.bench]
        session.skipCurrentExercise()
        #expect(session.currentExercise == Self.bench)
        #expect(session.phase == .overview) // unchanged — no workout was started
    }

    @Test func resetReturnsToACleanOverviewState() {
        let session = TrainingSessionManager()
        session.selectedExercises = [Self.squat]
        session.reset()
        #expect(session.selectedExercises.isEmpty)
        #expect(session.phase == .overview)
        #expect(session.completedSets.isEmpty)
    }
}

/// Swift-side goal/coaching-mode raw values must match
/// `convex/schema.ts`'s literal unions exactly — the same class of guard
/// as `WearableMetricTypeTests`.
struct GoalAndCoachingModeTests {
    @Test func goalCategoryRawValuesMatchTheConvexSchema() {
        #expect(GoalCategory.strength.rawValue == "strength")
        #expect(GoalCategory.hypertrophy.rawValue == "hypertrophy")
        #expect(GoalCategory.bodyComposition.rawValue == "body_composition")
        #expect(GoalCategory.fatLoss.rawValue == "fat_loss")
        #expect(GoalCategory.endurance.rawValue == "endurance")
        #expect(GoalCategory.runningPerformance.rawValue == "running_performance")
        #expect(GoalCategory.cyclingPerformance.rawValue == "cycling_performance")
        #expect(GoalCategory.sportPerformance.rawValue == "sport_performance")
        #expect(GoalCategory.recovery.rawValue == "recovery")
        #expect(GoalCategory.generalFitness.rawValue == "general_fitness")
        #expect(GoalCategory.maintenance.rawValue == "maintenance")
        #expect(GoalCategory.custom.rawValue == "custom")
    }

    @Test func coachingModeRawValuesMatchTheConvexSchema() {
        #expect(CoachingMode.fullControl.rawValue == "full_control")
        #expect(CoachingMode.recommendations.rawValue == "recommendations")
        #expect(CoachingMode.trackingOnly.rawValue == "tracking_only")
    }
}
