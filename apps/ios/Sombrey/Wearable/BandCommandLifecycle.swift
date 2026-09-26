import Foundation

// MARK: - Command outcomes that aren't SDK/data errors

/// Why a band command ended without the band's answer — kept apart from a
/// genuine SDK/data failure (`WearableSDKError`) so reconnect and sync logic
/// can tell "the link went away" from "the band said no".
enum WearableCommandError: Error, Equatable, CustomStringConvertible {
    /// The link dropped while the command was waiting for the band.
    case disconnected(command: String)
    /// The command was refused before it was sent: no live link.
    case notConnected(command: String)
    /// No answer within the command's time limit.
    case timedOut(command: String, seconds: Int)
    /// The awaiting task was cancelled (e.g. a newer sync replaced it).
    case cancelled(command: String)

    var description: String {
        switch self {
        case .disconnected(let c): return "\(c): band disconnected before answering"
        case .notConnected(let c): return "\(c): band not connected"
        case .timedOut(let c, let s): return "\(c): no answer from the band within \(s)s"
        case .cancelled(let c): return "\(c): cancelled"
        }
    }

    /// The link (not the band's data) is the reason — retry after reconnecting.
    var isLinkLoss: Bool {
        switch self {
        case .disconnected, .notConnected: return true
        case .timedOut, .cancelled: return false
        }
    }
}

extension Error {
    /// True when this error means "the band link went away", not a data error.
    var isBandLinkLoss: Bool { (self as? WearableCommandError)?.isLinkLoss ?? false }
}

// MARK: - One-shot completion

/// Completes a `CheckedContinuation` EXACTLY ONCE, from any thread.
///
/// Every band command has four possible terminal paths — the SDK's success
/// callback, its failure callback, the command's timeout, and cancellation
/// because the link dropped (or the awaiting task was cancelled). Vendor SDK
/// callbacks can fire more than once (success after failure, a late answer
/// after a disconnect) and on any queue. All four paths call `complete`;
/// the first one wins under a lock, every later one is a no-op that reports
/// `false` so it can be logged as a stale/duplicate callback. A resumed
/// continuation is dropped immediately, so it can never be resumed twice.
final class OneShotCompletion<T: Sendable>: @unchecked Sendable {
    let command: String
    private let lock = NSLock()
    private var continuation: CheckedContinuation<T, Error>?
    private var finished = false
    private var earlyResult: Result<T, Error>?
    private var onFinish: (@Sendable () -> Void)?

    init(command: String) {
        self.command = command
    }

    /// Installs the continuation. If a terminal path already fired (e.g.
    /// cancellation raced ahead of installation), it's completed right away.
    func install(_ continuation: CheckedContinuation<T, Error>, onFinish: @escaping @Sendable () -> Void) {
        lock.lock()
        if let early = earlyResult {
            earlyResult = nil
            lock.unlock()
            continuation.resume(with: early)
            onFinish()
            return
        }
        self.continuation = continuation
        self.onFinish = onFinish
        lock.unlock()
    }

    /// Completes with `result` if nothing has yet; returns whether this call won.
    @discardableResult
    func complete(_ result: Result<T, Error>) -> Bool {
        lock.lock()
        guard !finished else { lock.unlock(); return false }
        finished = true
        guard let continuation else {
            // Not installed yet — remember it for `install`.
            earlyResult = result
            lock.unlock()
            return true
        }
        self.continuation = nil
        let finish = onFinish
        onFinish = nil
        lock.unlock()
        continuation.resume(with: result)
        finish?()
        return true
    }

    var isFinished: Bool {
        lock.lock(); defer { lock.unlock() }
        return finished
    }
}

// MARK: - In-flight registry

/// Every band command currently waiting on the band, tagged with the link
/// instance (`epoch`) it was sent on. On disconnect, all of them are failed
/// at once with `.disconnected` — nothing is left waiting on a dead link.
@MainActor
final class BandCommandRegistry {
    struct Entry {
        let command: String
        let epoch: Int
        let startedAt: Date
        let fail: @Sendable (Error) -> Void
    }

    private(set) var inFlight: [UUID: Entry] = [:]

    func register(_ id: UUID, command: String, epoch: Int, fail: @escaping @Sendable (Error) -> Void) {
        inFlight[id] = Entry(command: command, epoch: epoch, startedAt: Date(), fail: fail)
    }

    func unregister(_ id: UUID) {
        inFlight[id] = nil
    }

    /// Fails every in-flight command; returns their names (for diagnostics).
    @discardableResult
    func failAll(_ makeError: (String) -> Error) -> [String] {
        let entries = inFlight
        inFlight.removeAll()
        for entry in entries.values { entry.fail(makeError(entry.command)) }
        return entries.values.map(\.command).sorted()
    }

    var count: Int { inFlight.count }
}

// MARK: - Reconnect backoff

/// Delay before re-issuing a connect after a FAILED attempt (CoreBluetooth's
/// own pending connect after a drop doesn't need one — it simply waits for
/// the band to come back in range). 1, 2, 4, 8, 16, 32, then 60 s.
enum ReconnectBackoff {
    static let cap: TimeInterval = 60

    static func delay(afterFailures failures: Int) -> TimeInterval {
        guard failures > 0 else { return 0 }
        return min(cap, pow(2, Double(failures - 1)))
    }
}

// MARK: - Command time limits

/// How long each kind of band command may wait for an answer. Generous —
/// history transfers over BLE can take a while — but finite: a command can
/// never hang the sync forever.
enum BandCommandTimeout {
    static let quick: TimeInterval = 15        // battery, time, firmware, Sport+ control
    static let history: TimeInterval = 45      // day histories (HR, SpO2, temperature, BP, sleep)
    static let sportRecords: TimeInterval = 60 // Sport+ record transfer (summaries + series)
    static let measurement: TimeInterval = 45  // on-demand measurement (the SDK's own window is 30 s)
}
