import Testing
import Foundation
import UIKit
@testable import SombreyApp

/// The Sombrey Exercise Library on the phone: Sombrey-shaped data only,
/// stable exercise ids, compatibility with workouts saved before it, and
/// the library feeding Sombrey's own workout builder.
struct ExerciseLibraryDecodingTests {
    private let summaryJSON = """
    {"_id":"k57abc","name":"Barbell Full Squat","description":"","muscleGroup":"legs",
     "primaryMuscles":["Glutes"],"equipment":["Barbell"],"difficulty":"intermediate","category":"strength","hasMedia":false}
    """

    @Test func librarySummaryDecodesAndKeepsItsSombreyId() throws {
        let exercise = try JSONDecoder().decode(LibraryExercise.self, from: Data(summaryJSON.utf8))
        #expect(exercise.id == "k57abc")
        #expect(exercise.summaryLine == "Glutes · Barbell")
        let asTraining = exercise.asExercise
        #expect(asTraining.id == "k57abc")
        #expect(asTraining.primaryMuscles == ["Glutes"])
    }

    @Test func missingOptionalFieldsStayMissing() throws {
        let json = #"{"_id":"x1","name":"Mystery Move","description":"","muscleGroup":"other","primaryMuscles":[],"equipment":[],"hasMedia":false}"#
        let exercise = try JSONDecoder().decode(LibraryExercise.self, from: Data(json.utf8))
        #expect(exercise.difficulty == nil)
        #expect(exercise.category == nil)
        #expect(exercise.summaryLine == "Other")
    }

    @Test func workoutsSavedBeforeTheLibraryStillRestore() throws {
        // An Exercise as older builds snapshotted it — no library fields.
        let old = #"{"_id":"e1","name":"Bench Press","description":"Press","muscleGroup":"chest"}"#
        let exercise = try JSONDecoder().decode(Exercise.self, from: Data(old.utf8))
        #expect(exercise.id == "e1")
        #expect(exercise.primaryMuscles == nil)
        let target = #"{"sets":3,"reps":10,"restSeconds":90}"#
        let decoded = try JSONDecoder().decode(TrainingSessionManager.PlanTarget.self, from: Data(target.utf8))
        #expect(decoded.weightKg == nil)
    }

    @Test func planItemsKeepTheirExerciseNameAndTarget() throws {
        let json = #"{"_id":"p1","name":"Push","source":"user","isCurrent":true,"nextDayIndex":0,"days":[{"name":"Day 1","exercises":[{"exerciseId":"e1","sets":3,"reps":8,"restSeconds":120,"targetWeightKg":60,"exerciseName":"Barbell Bench Press"}]}]}"#
        let plan = try JSONDecoder().decode(TrainingPlanDTO.self, from: Data(json.utf8))
        #expect(plan.days[0].exercises[0].exerciseName == "Barbell Bench Press")
        #expect(plan.days[0].exercises[0].targetWeightKg == 60)
    }

    @Test func vocabularyIsSombreys() {
        #expect(ExerciseVocabulary.muscleGroup("legs") == "Legs")
        #expect(ExerciseVocabulary.muscleGroup("other") == "Other")
        #expect(ExerciseVocabulary.difficulty("intermediate") == "Intermediate")
        #expect(ExerciseVocabulary.movement(mechanic: "compound", force: "push", unilateral: true) == "Compound · Push movement · One side at a time")
        #expect(ExerciseVocabulary.movement(mechanic: nil, force: nil, unilateral: nil) == nil)
    }
}

@MainActor
struct ExerciseLibraryWorkoutBuilderTests {
    private let squat = Exercise(id: "sq", name: "Barbell Full Squat", description: "", muscleGroup: "legs")
    private let row = Exercise(id: "rw", name: "Barbell Bent Over Row", description: "", muscleGroup: "back")

    @Test func addingToTheNextSessionCarriesTheUsersTargets() throws {
        let defaults = try #require(UserDefaults(suiteName: "library-\(UUID().uuidString)"))
        let session = TrainingSessionManager(defaults: defaults)
        let target = TrainingSessionManager.PlanTarget(sets: 5, reps: 5, restSeconds: 180, weightKg: 100)
        session.addToNextSession(squat, target: target)
        session.addToNextSession(squat, target: target) // no duplicate
        session.addToNextSession(row, target: nil)
        #expect(session.selectedExercises.map(\.id) == ["sq", "rw"])
        #expect(session.planTargets["sq"]?.weightKg == 100)
        session.toggle(squat)
        #expect(session.selectedExercises.map(\.id) == ["rw"])
        #expect(session.planTargets["sq"] == nil)
    }

    @Test func sameExerciseFromDifferentScreensIsOneExercise() throws {
        let defaults = try #require(UserDefaults(suiteName: "library-\(UUID().uuidString)"))
        let session = TrainingSessionManager(defaults: defaults)
        session.toggle(squat)
        // The same exercise, as the library describes it (more fields).
        let fromLibrary = Exercise(id: "sq", name: "Barbell Full Squat", description: "", muscleGroup: "legs", primaryMuscles: ["Glutes"])
        session.toggle(fromLibrary)
        #expect(session.selectedExercises.isEmpty)
    }
}

struct ExerciseMediaDecodingTests {
    /// A real 2-frame 1×1 GIF.
    private let gif = Data(base64Encoded: "R0lGODlhAQABAIAAAP///wAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAAAQABAAACAkQBACH5BAAKAAAALAAAAAABAAEAgAAAAP///wICTAEAOw==")!

    @Test func animatedDemonstrationsAnimateUnlessMotionIsReduced() {
        let animated = ExerciseMediaCache.decode(gif, still: false)
        #expect(animated != nil)
        let still = ExerciseMediaCache.decode(gif, still: true)
        #expect(still?.images == nil)
        #expect(ExerciseMediaCache.decode(Data("not an image".utf8), still: false) == nil)
    }
}

/// Every library card resolves its mark through one system — including the
/// three exercises that used to show a photo tile instead.
struct ExerciseCardMarkTests {
    private func summary(_ name: String, group: String, category: String?, media: Bool) -> LibraryExercise {
        LibraryExercise(id: name, name: name, description: "", muscleGroup: group, primaryMuscles: ["Abs"],
                        equipment: ["Body Weight"], difficulty: "beginner", category: category, hasMedia: media,
                        mediaUrl: media ? "https://example.invalid/m.gif" : nil)
    }

    @Test func theThreeExercisesUseTheSameMarkSystem() {
        // As stored in production: core / Abs / Body Weight / strength — and
        // each had a cached visual, which is what used to set them apart.
        for name in ["3/4 Sit-up", "45° Side Bend", "Air Bike"] {
            let e = summary(name, group: "core", category: "strength", media: true)
            #expect(ExerciseVocabulary.glyph(category: e.category, muscleGroup: e.muscleGroup) == "figure.core.training")
        }
        // A neighbouring core exercise without a visual resolves identically.
        let neighbour = summary("Alternate Heel Touchers", group: "core", category: "strength", media: false)
        #expect(ExerciseVocabulary.glyph(category: neighbour.category, muscleGroup: neighbour.muscleGroup) == "figure.core.training")
    }

    @Test func typeSpeaksBeforeMuscleWhereItSaysMore() {
        #expect(ExerciseVocabulary.glyph(category: "cardio", muscleGroup: "legs") == "figure.mixed.cardio")
        #expect(ExerciseVocabulary.glyph(category: "flexibility", muscleGroup: "back") == "figure.flexibility")
        #expect(ExerciseVocabulary.glyph(category: "balance", muscleGroup: "legs") == "figure.mind.and.body")
        #expect(ExerciseVocabulary.glyph(category: "plyometric", muscleGroup: "legs") == "figure.jumprope")
        #expect(ExerciseVocabulary.glyph(category: nil, muscleGroup: "chest") == "figure.strengthtraining.traditional")
        #expect(ExerciseVocabulary.glyph(category: "strength", muscleGroup: "other") == "figure.strengthtraining.functional")
    }
}

/// Log a Workout › From a plan: the chosen day becomes the session, with the
/// plan's own targets, still tied to its plan.
@MainActor
struct PlannedWorkoutTests {
    private let json = #"""
    {"_id":"plan1","name":"My Plan","source":"user","isCurrent":true,"nextDayIndex":1,"days":[
      {"name":"Upper Body","weekday":2,"exercises":[
        {"exerciseId":"bench","sets":4,"reps":8,"restSeconds":120,"targetWeightKg":60},
        {"exerciseId":"row","sets":3,"reps":10}]},
      {"name":"Lower Body","weekday":4,"exercises":[{"exerciseId":"squat","sets":5,"reps":5,"targetWeightKg":100}]},
      {"name":"Full Body","weekday":6,"exercises":[{"exerciseId":"gone","sets":3,"reps":10}]}]}
    """#
    private let library = [
        Exercise(id: "bench", name: "Barbell Bench Press", description: "", muscleGroup: "chest"),
        Exercise(id: "row", name: "Barbell Bent Over Row", description: "", muscleGroup: "back"),
        Exercise(id: "squat", name: "Barbell Full Squat", description: "", muscleGroup: "legs"),
    ]

    @Test func aPlanDayResolvesToItsExercisesAndTargets() throws {
        let plan = try JSONDecoder().decode(TrainingPlanDTO.self, from: Data(json.utf8))
        let upper = plan.days[0].resolved(with: library)
        #expect(upper.map(\.0.id) == ["bench", "row"])
        #expect(upper[0].1 == .init(sets: 4, reps: 8, restSeconds: 120, weightKg: 60))
        #expect(upper[1].1 == .init(sets: 3, reps: 10, restSeconds: nil, weightKg: nil))
        #expect(plan.days[0].weekdayName == Calendar.current.weekdaySymbols[1])
        // An exercise no longer in the library is left out, not invented.
        #expect(plan.days[2].resolved(with: library).isEmpty)
    }

    @Test func choosingItLoadsTheSessionTiedToThePlan() throws {
        let plan = try JSONDecoder().decode(TrainingPlanDTO.self, from: Data(json.utf8))
        let defaults = try #require(UserDefaults(suiteName: "planned-\(UUID().uuidString)"))
        let session = TrainingSessionManager(defaults: defaults)
        session.loadPlanDay(planId: plan.id, planName: plan.name, dayIndex: 1, dayName: plan.days[1].name,
                            exercises: plan.days[1].resolved(with: library))
        #expect(session.selectedExercises.map(\.id) == ["squat"])
        #expect(session.planTargets["squat"]?.weightKg == 100)
        #expect(session.workoutSource == .plan)
        #expect(session.trainingPlanId == "plan1")
        #expect(session.trainingPlanDayIndex == 1)
        // Adjusting before starting.
        session.setTarget(.init(sets: 5, reps: 3, restSeconds: 180, weightKg: 110), for: "squat")
        #expect(session.planTargets["squat"]?.reps == 3)
        session.setTarget(.init(sets: 1, reps: 1, restSeconds: nil), for: "not-in-session")
        #expect(session.planTargets["not-in-session"] == nil)
    }
}

/// History reads actual times when the band supplied them, and older rows
/// keep reading exactly as before.
struct WorkoutHistoryTimingTests {
    @Test func bandTimesAndCaloriesShowWhenPresent() throws {
        let json = #"{"_id":"w1","name":"Upper Body","startedAt":1000000,"completedAt":4000000,"durationSeconds":3000,"source":"plan","actualStartedAt":1120000,"actualEndedAt":4060000,"actualDurationSeconds":2940,"calories":342,"caloriesSource":"band_record","averageHeartRate":138,"highestHeartRate":161,"heartRateSource":"band_record","startTimeSource":"band"}"#
        let w = try JSONDecoder().decode(WorkoutHistoryDTO.self, from: Data(json.utf8))
        #expect(w.startDate == Date(timeIntervalSince1970: 1120))
        #expect(w.shownDurationSeconds == 2940)
        let entry = WorkoutHistory.merge(workouts: [w], sessions: []) { _ in "" }[0]
        #expect(entry.detail == "342 kcal · avg 138 bpm")
    }

    @Test func olderWorkoutsAreUnchanged() throws {
        let json = #"{"_id":"w0","name":"Old Session","startedAt":1000000,"completedAt":4000000,"durationSeconds":3000,"source":"user_created"}"#
        let w = try JSONDecoder().decode(WorkoutHistoryDTO.self, from: Data(json.utf8))
        #expect(w.startDate == Date(timeIntervalSince1970: 1000))
        #expect(w.shownDurationSeconds == 3000)
        #expect(w.calories == nil)
        let manual = #"{"_id":"m","name":"Run","startedAt":1000000,"completedAt":4000000,"durationSeconds":3000,"source":"manual","userReportedCalories":250}"#
        let m = try JSONDecoder().decode(WorkoutHistoryDTO.self, from: Data(manual.utf8))
        #expect(WorkoutHistory.merge(workouts: [m], sessions: []) { _ in "" }[0].detail == "250 kcal (your figure)")
    }
}

/// The library never presents a failed request as an empty library, and
/// never stays "loading" once the server has answered.
struct ExerciseLibraryStateTests {
    private func state(fetching: Bool = false, loaded: Bool = true, facetsFailed: Bool = false, total: Double = 387,
                       requestFailed: Bool = false, query: Bool = false) -> LibraryEmptyPresentation {
        LibraryEmptyPresentation.of(fetching: fetching, facetsLoaded: loaded, facetsFailed: facetsFailed, total: total,
                                    sourceRequestFailed: requestFailed, hasQuery: query)
    }

    @Test func loadingUntilTheServerAnswers() {
        #expect(state(loaded: false) == .loading)
        #expect(state(fetching: true, loaded: false) == .loading)
    }

    @Test func failuresAreFailuresNotAnEmptyLibrary() {
        #expect(state(facetsFailed: true) == .failed, "the facets query failed (auth, network, server)")
        #expect(state(loaded: false, facetsFailed: true) == .failed)
        #expect(state(loaded: false, requestFailed: true) == .failed)
        #expect(state(total: 0, requestFailed: true) == .failed, "a failed fetch on an empty library is an error, not 'no exercises'")
    }

    @Test func genuinelyEmptyOnlyWhenTheServerSaysSo() {
        #expect(state(total: 0) == .noExercisesYet, "answered: 0 exercises, nothing failed")
        #expect(state(fetching: true, total: 0) == .finding)
    }

    @Test func aPopulatedLibraryNeverReadsAsUnavailable() {
        #expect(state(total: 387, requestFailed: true) == .prompt, "the source being unreachable doesn't hide what the library holds")
        #expect(state(total: 387, query: true) == .noMatch)
    }

    /// The shapes production's exerciseLibrary:facets / :search return (verified 2026-10-01).
    @Test func productionShapedRepliesDecode() throws {
        let facets = #"{"total":387,"muscleGroups":["chest","back","shoulders","arms","legs","core","cardio"],"equipment":[{"key":"band","label":"Band"}],"difficulties":["beginner","intermediate","advanced"],"categories":["balance","cardio","flexibility","plyometric","strength"]}"#
        let f = try JSONDecoder().decode(LibraryFacets.self, from: Data(facets.utf8))
        #expect(f.total == 387)
        let search = #"{"hasMore":true,"items":[{"_id":"m97b","category":"strength","description":"3/4 Sit-up is a beginner exercise.","difficulty":"beginner","equipment":["Body Weight"],"hasMedia":false,"mediaUrl":null,"muscleGroup":"core","name":"3/4 Sit-up","primaryMuscles":["Abs"]}]}"#
        let r = try JSONDecoder().decode(LibrarySearchResult.self, from: Data(search.utf8))
        #expect(r.items.count == 1 && r.hasMore && r.items[0].mediaUrl == nil)
    }
}
