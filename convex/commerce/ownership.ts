// Sombrey commerce — Phase 6A: Band ownership (pure rules).
//
// Ordering a Band and having a Band are different things. An ownership record
// follows a Band from purchase to activation and connection — or to a return.
// A paid order never means a device has connected. How a Band is ACTIVATED
// (device code, QR, serial, Bluetooth-first, …) is undecided: activation goes
// through the ACTIVATION_METHODS registry, which is empty, so no activation
// mechanism exists until Phase 6G registers one. The existing G69/QCBandSDK
// pairing (wearableDevices) is untouched; a pairing can later be LINKED to an
// ownership record (`deviceRef`) without restructuring anything.
//
// Pure — tested in tests/commerce/ownership.test.ts.

export type OwnershipStatus =
  | "purchased" | "processing" | "shipped" | "delivered"
  | "activated" | "connected" | "disconnected"
  | "returned" | "cancelled";

export type OwnershipSource =
  | "order"           // a Sombrey commerce order (commerceOrders)
  | "legacy_pairing"  // a Band paired before commerce existed (decision pending — docs §9)
  | "staff_grant";    // granted by an owner/admin (audited) — e.g. replacements, testers

export const OWNERSHIP_TRANSITIONS: Record<OwnershipStatus, OwnershipStatus[]> = {
  purchased: ["processing", "cancelled"],
  processing: ["shipped", "cancelled"],
  shipped: ["delivered", "returned"],
  delivered: ["activated", "returned"],
  activated: ["connected", "returned"],
  connected: ["disconnected", "returned"],
  disconnected: ["connected", "returned"],
  returned: [],
  cancelled: [],
};

/** Statuses in which the user owns (or is receiving) a Band — PROVISIONAL:
 * includes purchased-but-undelivered, since the user has paid for it. */
export const OWNED_STATUSES: readonly OwnershipStatus[] = ["purchased", "processing", "shipped", "delivered", "activated", "connected", "disconnected"];

/** Activation mechanisms available — EMPTY until Phase 6G decides one. Each
 * entry will say how a physical Band is proven to belong to this account. */
export const ACTIVATION_METHODS: Readonly<Record<string, { description: string }>> = {};

export type OwnershipRecord = {
  status: OwnershipStatus;
  source: OwnershipSource;
  history: Array<{ status: OwnershipStatus; at: number; by: "system" | "provider" | "staff" }>;
  activation?: { method: string; deviceRef?: string; activatedAt: number };
};

export function transitionOwnership(r: OwnershipRecord, to: OwnershipStatus, at: number, by: "system" | "provider" | "staff",
  activation?: { method: string; deviceRef?: string }): { ok: true; record: OwnershipRecord } | { ok: false; error: string } {
  if (!(OWNERSHIP_TRANSITIONS[r.status] ?? []).includes(to)) return { ok: false, error: `Can't go from ${r.status} to ${to}` };
  if (to === "activated") {
    if (!activation) return { ok: false, error: "Activation needs a method" };
    if (!(activation.method in ACTIVATION_METHODS)) return { ok: false, error: "No activation method is available yet" };
  }
  return {
    ok: true,
    record: {
      ...r,
      status: to,
      history: [...r.history, { status: to, at, by }],
      ...(to === "activated" && activation ? { activation: { method: activation.method, ...(activation.deviceRef ? { deviceRef: activation.deviceRef } : {}), activatedAt: at } } : {}),
    },
  };
}

export function ownsBand(records: Array<Pick<OwnershipRecord, "status" | "source">>, opts: { countLegacyPairing: boolean }): boolean {
  return records.some((r) => OWNED_STATUSES.includes(r.status) && (r.source !== "legacy_pairing" || opts.countLegacyPairing));
}
