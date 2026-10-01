// Sombrey commerce — Phase 6G: the ONE writer of physical devices, device
// ownership and pairing links.
//
//   registerDevice / reissueCode   staff: a real unit (hardware id) + the hash of
//                                  its one-time activation code
//   assignDevice / unassignDevice  staff: the unit going into a fulfilment for a
//                                  specific order line (quantity-limited)
//   activateWithCode               customer: code → eligibility → ownership.
//                                  Refusals are RETURNED (not thrown) so failed
//                                  attempts are recorded for rate limiting.
//   staffActivate                  owner/admin: an in-person handover
//   deactivateDevice / retireDevice / endOwnershipForReturn
//   linkPairing                    customer: link a pairing (wearableDevices) to a
//                                  device they ALREADY own — never creates ownership
//
// Each runs inside one serializable Convex mutation (atomic, idempotent where
// retried). Ownership history is appended, never rewritten or deleted.
// Tested against an in-memory database in tests/commerce/devices.test.ts.

import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { knownProductIds, physicalProduct, type CommerceConfig } from "./config.ts";
import { validateEvent, type CommerceEventName } from "./events.ts";
import { DEVICE_TRANSITIONS, activationEligibility, normalizeHardwareId, type ActivationRefusal, type DeviceStatus, type HardwareIdKind } from "./devices.ts";
import { OWNERSHIP_TRANSITIONS } from "./ownership.ts";

type Db = MutationCtx["db"];
type Device = Doc<"commerceDevices">;
type Actor = "staff" | "customer" | "system";
const fail = (code: string, message: string) => new ConvexError({ code, message });

async function event(db: Db, config: CommerceConfig, name: CommerceEventName, userId: Id<"users"> | undefined, productId: string, now: number, source?: string, orderId?: Id<"commerceOrders">) {
  const problem = validateEvent({ name, platform: "backend", productId, ...(source ? { source } : {}) }, "server", knownProductIds(config));
  if (problem) throw fail("INVALID", problem);
  await db.insert("commerceEvents", {
    name, ...(userId ? { userId } : {}), at: now, origin: "server", platform: "backend", productId,
    ...(source ? { source } : {}), ...(orderId ? { orderId } : {}), configVersion: config.version,
  });
}

async function getDevice(db: Db, id: Id<"commerceDevices">): Promise<Device> {
  const d = await db.get(id);
  if (!d) throw fail("NOT_FOUND", "Device not found");
  return d;
}

async function moveDevice(db: Db, d: Device, to: DeviceStatus, by: Actor, now: number, extra: Partial<Device> = {}, reason?: string) {
  if (!DEVICE_TRANSITIONS[d.status].includes(to)) throw fail("INVALID", `A ${d.status} device can't become ${to}`);
  await db.patch(d._id, { ...extra, status: to, history: [...d.history, { status: to, at: now, by, ...(reason ? { reason } : {}) }], updatedAt: now });
}

/** End the device's current ownership (replaced / returned / deactivated) — history kept. */
async function endOwnership(db: Db, d: Device, to: "replaced" | "returned" | "deactivated", by: Actor, now: number, reason: string) {
  if (!d.currentOwnershipId) return;
  const o = await db.get(d.currentOwnershipId);
  if (!o || !OWNERSHIP_TRANSITIONS[o.status].includes(to)) return;
  await db.patch(o._id, { status: to, history: [...o.history, { status: to, at: now, by: by === "customer" ? "customer" : by === "staff" ? "staff" : "system", reason }], updatedAt: now });
}

// ─── Staff: register, assign ─────────────────────────────────────────────────

export async function registerDevice(db: Db, args: {
  productId: string; hardwareIdKind: HardwareIdKind; hardwareId: string; hardwareRevision?: string; activationCodeHash: string; staffUserId: Id<"users">;
}, config: CommerceConfig, now: number): Promise<{ deviceId: Id<"commerceDevices"> }> {
  const product = physicalProduct(config, args.productId);
  if (!product) throw fail("INVALID", "Unknown product");
  if (!product.identityKinds.includes(args.hardwareIdKind)) throw fail("INVALID", `This product isn't identified by ${args.hardwareIdKind}`);
  const hardwareId = normalizeHardwareId(args.hardwareIdKind, args.hardwareId);
  if (!hardwareId) throw fail("INVALID", "Invalid hardware identifier");
  if (!/^[0-9a-f]{64}$/.test(args.activationCodeHash)) throw fail("INVALID", "Invalid activation code hash");
  const existing = await db.query("commerceDevices").withIndex("by_hardware_id", (q) => q.eq("hardwareIdKind", args.hardwareIdKind).eq("hardwareId", hardwareId)).first();
  if (existing) throw fail("CONFLICT", "This device is already registered");
  const clash = await db.query("commerceDevices").withIndex("by_activation_code_hash", (q) => q.eq("activationCodeHash", args.activationCodeHash)).first();
  if (clash) throw fail("CONFLICT", "Activation code collision — generate another");
  const deviceId = await db.insert("commerceDevices", {
    productId: product.id, generation: product.hardwareGeneration, ...(args.hardwareRevision ? { hardwareRevision: args.hardwareRevision.slice(0, 40) } : {}),
    hardwareIdKind: args.hardwareIdKind, hardwareId, status: "registered",
    activationCodeHash: args.activationCodeHash, activationCodeIssuedAt: now, registeredByUserId: args.staffUserId,
    history: [{ status: "registered", at: now, by: "staff" }], createdAt: now, updatedAt: now,
  });
  return { deviceId };
}

/** A new code for a unit that hasn't been activated (lost insert, misprint). The old one stops working. */
export async function reissueCode(db: Db, deviceId: Id<"commerceDevices">, activationCodeHash: string, now: number) {
  const d = await getDevice(db, deviceId);
  if (d.status !== "registered" && d.status !== "assigned") throw fail("INVALID", "Only an unactivated device gets a new code");
  if (!/^[0-9a-f]{64}$/.test(activationCodeHash)) throw fail("INVALID", "Invalid activation code hash");
  await db.patch(d._id, { activationCodeHash, activationCodeIssuedAt: now, updatedAt: now });
}

/** Put a registered unit into a fulfilment: it becomes THE unit for one of that
 * order line's quantity. Replacement fulfilments name the device they replace. */
export async function assignDevice(db: Db, args: { deviceId: Id<"commerceDevices">; fulfillmentId: Id<"commerceFulfillments">; replacesDeviceId?: Id<"commerceDevices"> }, now: number) {
  const d = await getDevice(db, args.deviceId);
  if (d.fulfillmentId === args.fulfillmentId && d.status === "assigned") return { changed: false };
  if (d.status !== "registered") throw fail("INVALID", "Only a registered, unassigned device can be assigned");
  const f = await db.get(args.fulfillmentId);
  if (!f || f.status === "cancelled" || f.status === "failed") throw fail("INVALID", "That fulfilment can't take a device");
  const line = f.lines.find((l) => l.productId === d.productId);
  if (!line) throw fail("INVALID", "That fulfilment doesn't include this product");
  const already = (await db.query("commerceDevices").withIndex("by_fulfillment", (q) => q.eq("fulfillmentId", f._id)).collect())
    .filter((x) => x.productId === d.productId && x.status !== "registered" && x.status !== "retired");
  if (already.length >= line.quantity) throw fail("INVALID", "That fulfilment already has all its devices");
  if (f.kind === "replacement") {
    const old = args.replacesDeviceId ? await db.get(args.replacesDeviceId) : null;
    if (!old || old.orderId !== f.orderId || old.fulfillmentId !== f.replacesFulfillmentId || old.productId !== d.productId) {
      throw fail("INVALID", "A replacement must name the device it replaces, from the original fulfilment");
    }
  } else if (args.replacesDeviceId) throw fail("INVALID", "Only a replacement fulfilment replaces a device");
  await moveDevice(db, d, "assigned", "staff", now, { orderId: f.orderId, fulfillmentId: f._id, ...(args.replacesDeviceId ? { replacesDeviceId: args.replacesDeviceId } : {}) });
  return { changed: true };
}

export async function unassignDevice(db: Db, deviceId: Id<"commerceDevices">, now: number) {
  const d = await getDevice(db, deviceId);
  if (d.status === "registered") return { changed: false };
  if (d.status !== "assigned") throw fail("INVALID", "Only an assigned, unactivated device can be unassigned");
  await moveDevice(db, d, "registered", "staff", now, { orderId: undefined, fulfillmentId: undefined, replacesDeviceId: undefined });
  return { changed: true };
}

// ─── Activation ──────────────────────────────────────────────────────────────

export type ActivationResult =
  | { ok: true; deviceId: Id<"commerceDevices">; ownershipId: Id<"bandOwnership">; alreadyActive: boolean }
  | { ok: false; reason: ActivationRefusal };

async function recentFailures(db: Db, userId: Id<"users">, now: number) {
  return (await db.query("commerceActivationAttempts").withIndex("by_user_and_at", (q) => q.eq("userId", userId).gt("at", now - 3_600_000)).collect())
    .filter((a) => a.outcome === "failed").length;
}

async function activate(db: Db, d: Device, userId: Id<"users">, by: "customer" | "staff", config: CommerceConfig, now: number, handover = false): Promise<ActivationResult> {
  const order = d.orderId ? await db.get(d.orderId) : null;
  const fulfillment = d.fulfillmentId ? await db.get(d.fulfillmentId) : null;
  const e = activationEligibility({ userId, device: { status: d.status, productId: d.productId, ownerUserId: d.ownerUserId, orderId: d.orderId }, order, fulfillment, handover }, config);
  if (!e.ok) return e;
  if (e.alreadyYours) return { ok: true, deviceId: d._id, ownershipId: d.currentOwnershipId!, alreadyActive: true };
  // A replacement takes over from the device it replaces — never two active Bands for one.
  let replaced: Device | null = null;
  if (d.replacesDeviceId) {
    replaced = await db.get(d.replacesDeviceId);
    if (!replaced || replaced.orderId !== d.orderId) return { ok: false, reason: "not_activatable" };
    if (replaced.status === "activated" && replaced.ownerUserId !== userId) return { ok: false, reason: "not_eligible_for_account" };
  }
  const ownershipId = await db.insert("bandOwnership", {
    userId, source: "activation", deviceId: d._id, productId: d.productId, ...(d.orderId ? { orderId: d.orderId } : {}),
    status: "activated", history: [{ status: "activated", at: now, by, ...(handover ? { reason: "in_person_handover" } : {}) }],
    activation: { method: "activation_code", deviceRef: d._id, activatedAt: now }, createdAt: now, updatedAt: now,
  });
  await moveDevice(db, d, "activated", by, now, { ownerUserId: userId, currentOwnershipId: ownershipId, activatedAt: now, activationCodeUsedAt: now }, handover ? "in_person_handover" : undefined);
  await event(db, config, "device_activation_completed", userId, d.productId, now, handover ? "handover" : "code", d.orderId);
  if (replaced && replaced.status === "activated") {
    await endOwnership(db, replaced, "replaced", by, now, "replacement_activated");
    await moveDevice(db, replaced, "replaced", by, now, { endedAt: now }, "replacement_activated");
    await event(db, config, "device_replaced", userId, replaced.productId, now, undefined, replaced.orderId);
  }
  return { ok: true, deviceId: d._id, ownershipId, alreadyActive: false };
}

/** The customer's code (as SHA-256) → ownership, if the server finds them eligible. */
export async function activateWithCode(db: Db, userId: Id<"users">, codeHash: string, config: CommerceConfig, now: number): Promise<ActivationResult> {
  const record = async (r: ActivationResult) => {
    await db.insert("commerceActivationAttempts", { userId, at: now, outcome: r.ok ? "succeeded" : "failed", ...(r.ok ? {} : { reason: r.reason }) });
    if (!r.ok && r.reason !== "too_many_attempts") await event(db, config, "device_activation_failed", userId, config.products.band.id, now, r.reason);
    return r;
  };
  if (await recentFailures(db, userId, now) >= config.devices.activationAttemptsPerHour) return { ok: false, reason: "too_many_attempts" };
  if (!/^[0-9a-f]{64}$/.test(codeHash)) return record({ ok: false, reason: "invalid_code" });
  const d = await db.query("commerceDevices").withIndex("by_activation_code_hash", (q) => q.eq("activationCodeHash", codeHash)).first();
  if (!d) return record({ ok: false, reason: "invalid_code" });
  return record(await activate(db, d, userId, "customer", config, now));
}

/** Owner/admin: a staff-confirmed in-person handover (delivery need not be carrier-confirmed). */
export async function staffActivate(db: Db, deviceId: Id<"commerceDevices">, userId: Id<"users">, config: CommerceConfig, now: number): Promise<ActivationResult> {
  return activate(db, await getDevice(db, deviceId), userId, "staff", config, now, true);
}

// ─── End of ownership ────────────────────────────────────────────────────────

/** Owner/admin: end a device's activation (fraud/security, correction). History kept. */
export async function deactivateDevice(db: Db, deviceId: Id<"commerceDevices">, reason: string, config: CommerceConfig, now: number) {
  const d = await getDevice(db, deviceId);
  if (d.status === "deactivated") return { changed: false };
  if (d.status !== "activated") throw fail("INVALID", "Only an activated device can be deactivated");
  await endOwnership(db, d, "deactivated", "staff", now, reason);
  await moveDevice(db, d, "deactivated", "staff", now, { endedAt: now }, reason);
  await event(db, config, "device_deactivated", d.ownerUserId, d.productId, now, reason, d.orderId);
  return { changed: true };
}

export async function retireDevice(db: Db, deviceId: Id<"commerceDevices">, reason: string, now: number) {
  const d = await getDevice(db, deviceId);
  if (d.status === "retired") return { changed: false };
  await moveDevice(db, d, "retired", "staff", now, { activationCodeHash: undefined }, reason);
  return { changed: true };
}

/** Devices physically returned under a return: ownership ends (history kept).
 * Called at the configured moment (staff receipt, or verified refund). */
export async function endOwnershipForReturn(db: Db, orderId: Id<"commerceOrders">, deviceIds: Id<"commerceDevices">[], config: CommerceConfig, now: number) {
  for (const id of deviceIds) {
    const d = await getDevice(db, id);
    if (d.orderId !== orderId) throw fail("INVALID", "That device isn't from this order");
    if (d.status === "returned") continue;
    if (d.status === "activated") await endOwnership(db, d, "returned", "staff", now, "physical_return");
    if (d.status !== "activated" && d.status !== "assigned") throw fail("INVALID", `A ${d.status} device can't be returned`);
    await moveDevice(db, d, "returned", "staff", now, { endedAt: now, activationCodeHash: undefined }, "physical_return");
    await event(db, config, "device_returned", d.ownerUserId, d.productId, now, undefined, orderId);
  }
}

/** Devices named in a return must be units of that order, no more than the return covers. */
export async function validateReturnedDevices(db: Db, orderId: Id<"commerceOrders">, lines: Array<{ productId: string; quantity: number }>, deviceIds: Id<"commerceDevices">[]) {
  if (new Set(deviceIds).size !== deviceIds.length) throw fail("INVALID", "A device is listed twice");
  const counts = new Map<string, number>();
  for (const id of deviceIds) {
    const d = await getDevice(db, id);
    if (d.orderId !== orderId) throw fail("INVALID", "That device isn't from this order");
    counts.set(d.productId, (counts.get(d.productId) ?? 0) + 1);
  }
  for (const [productId, n] of counts) {
    if (n > (lines.find((l) => l.productId === productId)?.quantity ?? 0)) throw fail("INVALID", "More devices than the return covers");
  }
}

// ─── Pairing link ────────────────────────────────────────────────────────────

export type LinkResult = "linked" | "already_linked" | "not_paired_on_this_account" | "not_registered" | "not_activated" | "owned_by_another_account" | "invalid_identifier";

/** Link this user's pairing (the app's CBPeripheral id) to the physical device
 * whose hardware id the connected Band reported. Only a device the SAME user
 * already owns is linked; nothing here creates or moves ownership. */
export async function linkPairing(db: Db, userId: Id<"users">, args: { peripheralId: string; hardwareIdKind: HardwareIdKind; hardwareId: string }, config: CommerceConfig, now: number): Promise<{ result: LinkResult }> {
  const hardwareId = normalizeHardwareId(args.hardwareIdKind, args.hardwareId);
  if (!hardwareId) return { result: "invalid_identifier" };
  const pairing = await db.query("wearableDevices").withIndex("by_user_and_device", (q) => q.eq("userId", userId).eq("deviceId", args.peripheralId)).unique();
  if (!pairing) return { result: "not_paired_on_this_account" };
  const d = await db.query("commerceDevices").withIndex("by_hardware_id", (q) => q.eq("hardwareIdKind", args.hardwareIdKind).eq("hardwareId", hardwareId)).first();
  if (!d) return { result: "not_registered" };
  if (d.status !== "activated") return { result: "not_activated" };
  if (d.ownerUserId !== userId) return { result: "owned_by_another_account" };
  if (pairing.physicalDeviceId === d._id) return { result: "already_linked" };
  await db.patch(pairing._id, { physicalDeviceId: d._id, linkedAt: now });
  await event(db, config, "device_paired", userId, d.productId, now, undefined, d.orderId);
  return { result: "linked" };
}

/** Account deletion: devices this user had activated are deactivated (history
 * kept, so the unit can be handled by staff — never left "activated" to a
 * deleted account); their activation attempts are removed. */
export async function releaseDevicesOnAccountDeletion(db: Db, userId: Id<"users">, now: number) {
  for (const d of await db.query("commerceDevices").withIndex("by_owner", (q) => q.eq("ownerUserId", userId)).collect()) {
    if (d.status === "activated") await moveDevice(db, d, "deactivated", "system", now, { endedAt: now, ownerUserId: undefined, currentOwnershipId: undefined }, "account_deleted");
    else await db.patch(d._id, { ownerUserId: undefined, currentOwnershipId: undefined, updatedAt: now });
  }
  for (const a of await db.query("commerceActivationAttempts").withIndex("by_user_and_at", (q) => q.eq("userId", userId)).collect()) await db.delete(a._id);
}
