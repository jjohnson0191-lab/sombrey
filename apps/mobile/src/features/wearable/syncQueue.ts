import type { WearableMeasurement } from "@sombrey/wearable";

/**
 * Offline/sync foundation — interface only, per Phase 3 scope. The band
 * collects data whether or not the phone is reachable, so sync can't be
 * designed assuming constant connectivity:
 *
 *   Band -> native layer -> local sync boundary (this) -> Convex sync
 *
 * Not implemented: a real local persistence layer (e.g. Capacitor
 * Preferences/SQLite) for measurements collected while offline. This
 * interface exists so the native plugin and the eventual Convex-sync
 * hook can both be written against a stable shape, without every caller
 * assuming synchronous, always-online delivery.
 *
 * Duplicate-sync protection (idempotent upserts keyed by device-reported
 * record identity) is a backend concern — see the wearable data model in
 * the architecture report (syncEvents, dedupe-by-recordedAt) — not
 * something this client-side interface re-implements.
 */
export interface SombreySyncQueue {
  enqueue(measurement: WearableMeasurement): Promise<void>;
  drain(): Promise<WearableMeasurement[]>;
  size(): Promise<number>;
}

/**
 * In-memory placeholder — lost on app restart. Real implementation
 * (persisted, survives app kill) is sync-phase work, not foundation
 * work; this exists only so calling code can be written against the
 * interface today.
 */
export const inMemorySyncQueue: SombreySyncQueue = (() => {
  let queue: WearableMeasurement[] = [];
  return {
    async enqueue(measurement) {
      queue.push(measurement);
    },
    async drain() {
      const drained = queue;
      queue = [];
      return drained;
    },
    async size() {
      return queue.length;
    },
  };
})();
