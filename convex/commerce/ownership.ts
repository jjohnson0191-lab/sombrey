// Sombrey commerce — Phase 6A: Band ownership (pure rules).
//
// Ordering a Band and having a Band are different things.
// Phase 6G: ownership of a PHYSICAL device (commerceDevices) starts only by
// ACTIVATION — a one-time code that came in the box ("activation_code") —
// never from payment, shipping, delivery, Bluetooth discovery or pairing. It
// ends as replaced, returned or deactivated; the record is never deleted, so
// the history stays auditable. Pairing (wearableDevices) is separate: a pairing
// may be LINKED to a device its user already owns, and grants nothing.
// The 6A order-flavoured statuses (purchased…connected) remain only for older
// records; 6E stopped creating order ownership.
//
// Pure — tested in tests/commerce/ownership.test.ts.

export type OwnershipStatus =
  | "purchased" | "processing" | "shipped" | "delivered"
  | "activated" | "connected" | "disconnected"
  | "returned" | "cancelled"
  | "replaced" | "deactivated";   // 6G

export type OwnershipSource =
  | "order"           // a Sombrey commerce order (commerceOrders)
  | "legacy_pairing"  // a Band paired before commerce existed — recorded ONLY by the audited internal grant (6D)
  | "staff_grant"     // granted by an owner/admin (audited) — e.g. testers
  | "activation";     // 6G: the customer activated a registered physical device (commerceDevices)

export const OWNERSHIP_TRANSITIONS: Record<OwnershipStatus, OwnershipStatus[]> = {
  purchased: ["processing", "cancelled"],
  processing: ["shipped", "cancelled"],
  shipped: ["delivered", "returned"],
  delivered: ["activated", "returned"],
  activated: ["connected", "returned", "replaced", "deactivated"],
  connected: ["disconnected", "returned"],
  disconnected: ["connected", "returned"],
  returned: [],
  cancelled: [],
  replaced: [],
  deactivated: [],
};

/** Statuses in which the user owns (or is receiving) a Band — PROVISIONAL:
 * includes purchased-but-undelivered, since the user has paid for it. */
export const OWNED_STATUSES: readonly OwnershipStatus[] = ["purchased", "processing", "shipped", "delivered", "activated", "connected", "disconnected"];

/** How a physical Band is proven to belong to an account (Phase 6G). */
export const ACTIVATION_METHODS: Readonly<Record<string, { description: string }>> = {
  activation_code: { description: "A one-time code generated when the device was registered and packed with it; possession of the box is the proof. The server stores only its SHA-256." },
};

export type OwnershipRecord = {
  status: OwnershipStatus;
  source: OwnershipSource;
  history: Array<{ status: OwnershipStatus; at: number; by: "system" | "provider" | "staff" | "customer"; reason?: string }>;
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
