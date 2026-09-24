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
