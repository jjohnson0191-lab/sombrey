import Foundation
import Observation

/// Drives a physical activity (Tennis, a run, a surf) as its own state
/// machine: idle → active (pausable) → complete. Distinct from
/// `TrainingSessionManager`, which is structured training (exercises,
/// sets, reps); the two are never merged into one "workout".
///
/// The band does the recording: starting an activity starts the band's
/// own session for that activity and its Convex record
/// (`WearableManager.startSportSession`). What the phone adds is the
/// wall-clock timing (pauses excluded) and the last live tally the band
/// pushed; the band's own post-session record replaces those figures once
/// it's imported.
///
/// Reliability, as for training: owned at app level, snapshotted to
/// `UserDefaults` while live, restored after an app kill — the band keeps
/// recording regardless, so a relaunch re-attaches to it rather than
/// losing the session.
@Observable
@MainActor
final class ActivitySessionManager {
    enum Phase: String, Codable {
        case idle
        case active
        case complete
    }

    /// The band's last live tally for this session — kept for the summary
    /// until the band's own record lands.
    struct LiveTally: Codable, Equatable {
        let durationSeconds: Int
        let heartRate: Int
        let steps: Int
        let distanceMeters: Int
        let calories: Double
    }

    private(set) var phase: Phase = .idle
    private(set) var activity: SombreyActivity?
    private(set) var startedAt: Date?
    private(set) var finishedAt: Date?
    private(set) var pausedAt: Date?
    private(set) var pausedSeconds: TimeInterval = 0
    /// The Convex `sportPlusSessions` row for this activity.
    private(set) var sessionId: String?
    private(set) var finalTally: LiveTally?
    private(set) var isStarting = false
    /// Why the last start didn't happen, in the user's terms.
    private(set) var startFailure: String?

    private let defaults: UserDefaults
    private static let snapshotKey = "sombreyActivity.activeSession.v1"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    var isPaused: Bool { pausedAt != nil }

    /// Active (unpaused) seconds at `date`.
    func activeSeconds(at date: Date = Date()) -> Int {
        guard let startedAt else { return 0 }
        let end = finishedAt ?? pausedAt ?? date
        return max(0, Int(end.timeIntervalSince(startedAt) - pausedSeconds))
    }

    // MARK: - Lifecycle

    func start(_ activity: SombreyActivity, wearable: WearableManager) async {
        guard phase == .idle, !isStarting else { return }
        startFailure = nil
        guard wearable.pairedDevice != nil else {
            startFailure = "Connect your Sombrey Band to record \(activity.name)."
            return
        }
        guard wearable.displayState == .connected || wearable.displayState == .syncing else {
            startFailure = "Your band isn't connected right now. Bring it close and try again — or start \(activity.name) on the band itself; Sombrey brings it in automatically."
            return
        }
        guard let sportType = activity.sportType else {
            startFailure = "\(activity.name) can't be started from here yet."
            return
        }
        isStarting = true
        defer { isStarting = false }
        let started = await wearable.startSportSession(type: sportType)
        guard started, let active = wearable.activeSportSession else {
            startFailure = "The band didn't start \(activity.name). You can start it on the band itself — Sombrey brings it in automatically."
            return
        }
        ActivityRecents.remember(activity.key)
        self.activity = activity
        startedAt = active.startedAt
        finishedAt = nil
        pausedAt = nil
        pausedSeconds = 0
        sessionId = active.convexSessionId
        finalTally = nil
        phase = .active
        save()
    }

    func pause(wearable: WearableManager) {
        guard phase == .active, pausedAt == nil else { return }
        pausedAt = Date()
        save()
        Task { await wearable.pauseSportSession() }
    }

    func resume(wearable: WearableManager) {
        guard let pausedAt else { return }
        pausedSeconds += Date().timeIntervalSince(pausedAt)
        self.pausedAt = nil
        save()
        Task { await wearable.resumeSportSession() }
    }

    func finish(wearable: WearableManager) async {
        guard phase == .active else { return }
        if let pausedAt {
            pausedSeconds += Date().timeIntervalSince(pausedAt)
            self.pausedAt = nil
        }
        finishedAt = Date()
        if wearable.activeSportSession != nil {
            _ = await wearable.stopSportSession(appActiveSeconds: activeSeconds())
            if let update = wearable.lastCompletedSportSession {
                finalTally = LiveTally(
                    durationSeconds: update.durationSeconds,
                    heartRate: update.heartRate,
                    steps: update.steps,
                    distanceMeters: update.distanceMeters,
                    calories: update.calories
                )
            }
        }
        phase = .complete
        clearSnapshot()
    }

    /// Back to choosing an activity.
    func reset() {
        phase = .idle
        activity = nil
        startedAt = nil
        finishedAt = nil
        pausedAt = nil
        pausedSeconds = 0
        sessionId = nil
        finalTally = nil
        startFailure = nil
        clearSnapshot()
    }

    func clearStartFailure() {
        startFailure = nil
    }

    // MARK: - Snapshot (recovery after an app kill)

    private struct Snapshot: Codable {
        let activityKey: String
        let startedAt: Date
        let pausedAt: Date?
        let pausedSeconds: TimeInterval
        let sessionId: String
        let vendorSportType: Int
    }

    private func save() {
        guard phase == .active, let activity, let startedAt, let sessionId else { return }
        let snapshot = Snapshot(
            activityKey: activity.key, startedAt: startedAt, pausedAt: pausedAt,
            pausedSeconds: pausedSeconds, sessionId: sessionId, vendorSportType: activity.vendorSportType
        )
        if let data = try? JSONEncoder().encode(snapshot) {
            defaults.set(data, forKey: Self.snapshotKey)
        }
    }

    private func clearSnapshot() {
        defaults.removeObject(forKey: Self.snapshotKey)
    }

    /// Restores an activity that was running when the app was killed. The
    /// band kept recording, so the clock keeps running too (unlike a
    /// structured workout, which the user drives set by set).
    func restoreIfNeeded() {
        guard phase == .idle,
              let data = defaults.data(forKey: Self.snapshotKey),
              let snapshot = try? JSONDecoder().decode(Snapshot.self, from: data),
              let activity = ActivityCatalog.byKey[snapshot.activityKey] else { return }
        self.activity = activity
        startedAt = snapshot.startedAt
        pausedAt = snapshot.pausedAt
        pausedSeconds = snapshot.pausedSeconds
        sessionId = snapshot.sessionId
        phase = .active
    }

    /// Re-attaches the restored activity to the band's running session once
    /// the band is back, so pause/end reach it.
    func reattachIfNeeded(wearable: WearableManager) {
        guard phase == .active, let activity, let startedAt, let sessionId,
              wearable.activeSportSession == nil, wearable.pairedDevice != nil else { return }
        wearable.adoptSportSession(sportType: activity.vendorSportType, convexSessionId: sessionId, startedAt: startedAt)
    }
}

/// The activities this user picked most recently on this phone, for
/// "what are you doing today?" before the server's history loads (and for
/// a brand-new user whose first activity hasn't synced yet).
enum ActivityRecents {
    private static let key = "sombreyActivity.recentKeys.v1"

    static func remember(_ activityKey: String, defaults: UserDefaults = .standard) {
        var keys = recent(defaults: defaults).filter { $0 != activityKey }
        keys.insert(activityKey, at: 0)
        defaults.set(Array(keys.prefix(8)), forKey: key)
    }

    static func recent(defaults: UserDefaults = .standard) -> [String] {
        defaults.stringArray(forKey: key) ?? []
    }
}
