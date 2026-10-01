// Sombrey commerce, Phase 6G — physical devices, activation, ownership, pairing links
// (devices.ts, deviceStore.ts, staffDevices.ts, myDevices.ts; integration with 6D
// entitlements and 6F returns). SYNTHETIC data; carrier/payment events are TEST
// DOUBLES that exist only in this file. No real Band, MAC or code is used.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COMMERCE_CONFIG, validateCommerceConfig, type CommerceConfig } from "../../convex/commerce/config.ts";
import {
  ACTIVATION_ALPHABET, activationEligibility, generateActivationCode, hashActivationCode, normalizeActivationCode, normalizeHardwareId, redactHardwareId,
} from "../../convex/commerce/devices.ts";
import {
  activateWithCode, assignDevice, deactivateDevice, linkPairing, registerDevice, releaseDevicesOnAccountDeletion, staffActivate, unassignDevice,
} from "../../convex/commerce/deviceStore.ts";
import { applyShipmentEvent, createFulfillment, recordShipment, recordSubmission } from "../../convex/commerce/fulfillmentStore.ts";
import { authorizeReturn, completeRefund, receiveReturn, requestReturn } from "../../convex/commerce/returnsStore.ts";
import { applyVerifiedPayment, createOrderRecord } from "../../convex/commerce/checkoutStore.ts";
import { computeEntitlements } from "../../convex/commerce/entitlements.ts";
import { staffMay } from "../../convex/commerce/staffAccess.ts";
import { MemoryDb } from "./memoryDb.ts";

const C = COMMERCE_CONFIG;
const T = Date.UTC(2026, 9, 1, 12);
const H = 3_600_000, DAY = 24 * H;
const ALICE = "users:alice" as never, BOB = "users:bob" as never, STAFF = "users:staff" as never;
const row = (db: MemoryDb, id: unknown): Record<string, unknown> => db.get(id as string)!;
const MAC_A = "02:00:5E:10:00:0A", MAC_B = "02:00:5E:10:00:0B", MAC_R = "02:00:5E:10:00:0C";
let seq = 0;

async function paidOrder(db: MemoryDb, user = ALICE, qty = 1) {
  const { orderId } = await createOrderRecord(db as never, { userId: user, items: [{ productId: "sombrey_band", quantity: qty }], shippingAddress: { fullName: "A Customer", line1: "1 Test Street", city: "Colombo", countryCode: "LK" }, checkoutRequestKey: `ck-device-${++seq}-000000` }, C, T, () => 0.5);
  const total = 10000 * qty + 2300;
  await db.patch(orderId as string, { shippingCents: 1500, taxCents: 800, totalCents: total, paymentAttempt: { provider: "test-pay", idempotencyKey: "k", quoteId: "q", amountCents: total, currency: "USD", providerRef: `pi_${seq}`, startedAt: T } });
  await applyVerifiedPayment(db as never, { orderId: orderId as never, provider: "test-pay", event: { eventId: `paid-${seq}`, providerRef: `pi_${seq}`, type: "paid", amountCents: total, currency: "USD" } }, C, T);
  return { orderId, total, ref: `pi_${seq}` };
}

/** A submitted fulfilment with one outbound shipment (delivered if asked). */
async function fulfil(db: MemoryDb, orderId: unknown, opts: { delivered?: boolean; kind?: "original" | "replacement"; replaces?: unknown } = {}) {
  const n = ++seq;
  const { fulfillmentId } = await createFulfillment(db as never, { orderId: orderId as never, idempotencyKey: `ful-device-${n}-0000`, kind: opts.kind ?? "original", ...(opts.replaces ? { replacesFulfillmentId: opts.replaces as never } : {}) }, C, T);
  await recordSubmission(db as never, fulfillmentId, { provider: "test-ship", providerRef: `FUL-${n}` }, T);
  await recordShipment(db as never, { direction: "outbound", fulfillmentId, idempotencyKey: `ship-device-${n}-00`, provider: "test-ship", created: { ok: true, providerRef: `SHP-${n}`, carrier: "TestCarrier", service: "standard" } }, C, T);
  if (opts.delivered) await applyShipmentEvent(db as never, { provider: "test-ship", event: { eventId: `dlv-${n}`, providerRef: `SHP-${n}`, type: "delivered", providerStatus: "DLV", occurredAt: T + DAY } }, C, T + DAY);
  return fulfillmentId;
}

/** A registered unit and its (synthetic) printed code. */
async function unit(db: MemoryDb, mac: string) {
  const bytes = new Uint8Array(12); crypto.getRandomValues(bytes);
  const code = generateActivationCode(bytes);
  const { deviceId } = await registerDevice(db as never, { productId: "sombrey_band", hardwareIdKind: "mac", hardwareId: mac, activationCodeHash: await hashActivationCode(normalizeActivationCode(code)!), staffUserId: STAFF }, C, T);
  return { deviceId, code };
}
const activate = async (db: MemoryDb, user: unknown, code: string, now = T + 2 * DAY) =>
  db.serial(async () => activateWithCode(db as never, user as never, await hashActivationCode(normalizeActivationCode(code) ?? "x"), C, now));

/** Alice: a paid, delivered order and its assigned, unactivated unit. */
async function ready(db: MemoryDb, mac = MAC_A, user = ALICE) {
  const { orderId, total, ref } = await paidOrder(db, user);
  const fulfillmentId = await fulfil(db, orderId, { delivered: true });
  const { deviceId, code } = await unit(db, mac);
  await assignDevice(db as never, { deviceId, fulfillmentId }, T);
  return { orderId, fulfillmentId, deviceId, code, total, ref };
}
const ownerships = (db: MemoryDb) => db.rows("bandOwnership");
const bandFor = (db: MemoryDb, user: unknown, pairedDevices = 0) => computeEntitlements({
  ownership: ownerships(db).filter((o) => o.userId === user).map((o) => ({ status: o.status, source: o.source, productId: o.productId })) as never,
  subscriptions: [], legacyPremium: false, pairedDevices,
}, C, T).ownsBand;

// ─── Identity ────────────────────────────────────────────────────────────────

test("physical identity: a real hardware identifier — never a Bluetooth name or an iPhone's peripheral id", () => {
  assert.deepEqual(validateCommerceConfig(C), []);
  assert.deepEqual(C.products.band.identityKinds, ["mac"], "the SDK exposes a MAC, no serial number");
  assert.equal(normalizeHardwareId("mac", "02-00-5e-10-00-0a"), MAC_A);
  for (const notAnId of ["G69", "Sombrey Band", "6F1A2B3C-0000-4000-8000-000000000001", "00:00:00:00:00:00", "FF:FF:FF:FF:FF:FF", "", 42]) {
    assert.equal(normalizeHardwareId("mac", notAnId), null, String(notAnId));
  }
  assert.equal(redactHardwareId(MAC_A), "…000A");
});

test("activation codes: 60 bits from cryptographic randomness, forgiving to type, stored only as a hash", async () => {
  assert.equal(ACTIVATION_ALPHABET.length, 32);
  const codes = new Set(Array.from({ length: 500 }, () => { const b = new Uint8Array(12); crypto.getRandomValues(b); return generateActivationCode(b); }));
  assert.equal(codes.size, 500);
  const [code] = codes;
  assert.match(code, /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  assert.equal(normalizeActivationCode(` ${code.toLowerCase().replace(/-/g, " ")} `), code.replace(/-/g, ""));
  assert.equal(normalizeActivationCode("OOOO-IIII-LLLL"), "000011111111");
  assert.equal(normalizeActivationCode("UUUU-UUUU-UUUU"), null);
  assert.match(await hashActivationCode("000011111111"), /^[0-9a-f]{64}$/);
  const db = new MemoryDb();
  const { deviceId, code: printed } = await unit(db, MAC_A);
  assert.ok(!JSON.stringify(row(db, deviceId)).includes(printed.replace(/-/g, "")), "the code itself is never stored");
});

test("registration: one record per physical unit, only with an identifier the product has", async () => {
  const db = new MemoryDb();
  await unit(db, MAC_A);
  await assert.rejects(unit(db, "02-00-5E-10-00-0A"), /already registered/);
  await assert.rejects(registerDevice(db as never, { productId: "sombrey_band", hardwareIdKind: "serial", hardwareId: "SN12345", activationCodeHash: "a".repeat(64), staffUserId: STAFF }, C, T), /isn't identified by serial/);
  await assert.rejects(registerDevice(db as never, { productId: "sombrey_band_v2", hardwareIdKind: "mac", hardwareId: MAC_B, activationCodeHash: "b".repeat(64), staffUserId: STAFF }, C, T), /Unknown product/, "no future product is invented");
  assert.equal(db.rows("commerceDevices").length, 1);
});

test("order ≠ device: paying and delivering assigns nothing; staff assign real units, never more than the line's quantity", async () => {
  const db = new MemoryDb();
  const { orderId } = await paidOrder(db, ALICE, 2);
  const fulfillmentId = await fulfil(db, orderId, { delivered: true });
  assert.equal(db.rows("commerceDevices").length, 0, "no device appears because an order was paid or delivered");
  assert.equal(ownerships(db).length, 0);
  const a = await unit(db, MAC_A), b = await unit(db, MAC_B), c = await unit(db, MAC_R);
  await assignDevice(db as never, { deviceId: a.deviceId, fulfillmentId }, T);
  await assignDevice(db as never, { deviceId: b.deviceId, fulfillmentId }, T);
  await assert.rejects(assignDevice(db as never, { deviceId: c.deviceId, fulfillmentId }, T), /already has all its devices/, "two Bands bought → two units, not three");
  assert.deepEqual([row(db, a.deviceId).orderId, row(db, b.deviceId).orderId], [orderId, orderId]);
  await unassignDevice(db as never, a.deviceId, T);
  assert.equal(row(db, a.deviceId).status, "registered");
});

// ─── Activation ──────────────────────────────────────────────────────────────

test("activation: delivered + the code from the box → ownership of that physical device; Band features follow", async () => {
  const db = new MemoryDb();
  const { deviceId, code, orderId } = await ready(db);
  assert.equal(bandFor(db, ALICE), false, "delivered isn't owned");
  assert.deepEqual(await activate(db, ALICE, code), { ok: true, deviceId, ownershipId: row(db, deviceId).currentOwnershipId, alreadyActive: false });
  const o = ownerships(db)[0];
  assert.deepEqual([o.userId, o.source, o.deviceId, o.productId, o.orderId, o.status], [ALICE, "activation", deviceId, "sombrey_band", orderId, "activated"]);
  assert.deepEqual([row(db, deviceId).status, row(db, deviceId).ownerUserId], ["activated", ALICE]);
  assert.equal(bandFor(db, ALICE), true);
  assert.ok(db.rows("commerceEvents").some((e) => e.name === "device_activation_completed"));
});

test("eligibility is the server's: not before delivery, not unpaid, not cancelled; activation never follows from payment or delivery alone", async () => {
  const db = new MemoryDb();
  const { orderId } = await paidOrder(db);
  const fulfillmentId = await fulfil(db, orderId);   // shipped, not delivered
  const { deviceId, code } = await unit(db, MAC_A);
  await assignDevice(db as never, { deviceId, fulfillmentId }, T);
  assert.deepEqual(await activate(db, ALICE, code), { ok: false, reason: "not_delivered" });
  // The pure rule, for the remaining cases.
  const base = { userId: "u", device: { status: "assigned" as const, productId: "sombrey_band", orderId: "o" }, order: { userId: "u", paymentStatus: "paid" as const }, fulfillment: { status: "delivered" as const, orderId: "o" } };
  assert.deepEqual(activationEligibility(base, C), { ok: true });
  assert.deepEqual(activationEligibility({ ...base, order: { userId: "u", paymentStatus: "refunded" } }, C), { ok: false, reason: "not_paid" });
  assert.deepEqual(activationEligibility({ ...base, order: { userId: "u", paymentStatus: "paid", cancelledAt: 1 } }, C), { ok: false, reason: "not_paid" });
  assert.deepEqual(activationEligibility({ ...base, device: { ...base.device, status: "registered" } }, C), { ok: false, reason: "not_activatable" });
  assert.deepEqual(activationEligibility({ ...base, fulfillment: { status: "shipped", orderId: "o" }, handover: true }, C), { ok: true }, "an in-person handover replaces carrier delivery");
  const lax: CommerceConfig = structuredClone(C); lax.devices.activationRequiresDelivery = false;
  assert.deepEqual(activationEligibility({ ...base, fulfillment: { status: "shipped", orderId: "o" } }, lax), { ok: true }, "configurable");
  assert.equal(ownerships(db).length, 0);
});

test("cross-account: Bob can't activate Alice's Band (even with her code), can't take it once activated; Alice can't take Bob's", async () => {
  const db = new MemoryDb();
  const alice = await ready(db, MAC_A, ALICE);
  const bob = await ready(db, MAC_B, BOB);
  assert.deepEqual(await activate(db, BOB, alice.code), { ok: false, reason: "not_eligible_for_account" }, "a code for another customer's order");
  assert.deepEqual(await activate(db, ALICE, bob.code), { ok: false, reason: "not_eligible_for_account" });
  assert.equal((await activate(db, ALICE, alice.code)).ok, true);
  assert.deepEqual(await activate(db, BOB, alice.code), { ok: false, reason: "already_activated" }, "an owned device can't be claimed");
  assert.equal(row(db, alice.deviceId).ownerUserId, ALICE);
  assert.deepEqual([bandFor(db, ALICE), bandFor(db, BOB)], [true, false]);
});

test("activation is idempotent: retries, a relaunch, a second phone → the same single ownership", async () => {
  const db = new MemoryDb();
  const { code, deviceId } = await ready(db);
  const results = await Promise.all(Array.from({ length: 6 }, () => activate(db, ALICE, code)));
  assert.ok(results.every((r) => r.ok));
  assert.equal(results.filter((r) => r.ok && !r.alreadyActive).length, 1);
  assert.equal(ownerships(db).length, 1, "never duplicate ownership");
  assert.equal(row(db, deviceId).status, "activated");
});

test("wrong codes are refused and counted; guessing is limited per account per hour", async () => {
  const db = new MemoryDb();
  const { code } = await ready(db);
  for (let i = 0; i < C.devices.activationAttemptsPerHour; i++) assert.deepEqual(await activate(db, ALICE, `0000-0000-${String(i).padStart(4, "0")}`), { ok: false, reason: "invalid_code" });
  assert.deepEqual(await activate(db, ALICE, code), { ok: false, reason: "too_many_attempts" }, "even the right code waits");
  assert.equal((await activate(db, ALICE, code, T + 2 * DAY + 2 * H)).ok, true, "an hour later");
  assert.deepEqual(await activate(db, ALICE, "not a code", T + 2 * DAY + 2 * H), { ok: false, reason: "invalid_code" }, "malformed input is just an invalid code");
});

// ─── Pairing ─────────────────────────────────────────────────────────────────

async function paired(db: MemoryDb, user: unknown, peripheralId: string) {
  // What wearable:upsertDevice records when the app pairs (the iPhone's CBPeripheral id).
  return db.insert("wearableDevices", { userId: user, deviceId: peripheralId, model: "G69", nickname: "G69" });
}

test("pairing never creates ownership; a pairing links only to a device its user already owns", async () => {
  const db = new MemoryDb();
  const { code, deviceId } = await ready(db);
  const alicePairing = await paired(db, ALICE, "PERIPHERAL-ALICE");
  assert.deepEqual(await linkPairing(db as never, ALICE, { peripheralId: "PERIPHERAL-ALICE", hardwareIdKind: "mac", hardwareId: MAC_A }, C, T), { result: "not_activated" });
  assert.equal(ownerships(db).length, 0, "pairing/linking an unactivated Band grants nothing");
  assert.equal(bandFor(db, ALICE, 1), false, "a pairing alone isn't a Band");
  await activate(db, ALICE, code);
  assert.deepEqual(await linkPairing(db as never, ALICE, { peripheralId: "PERIPHERAL-ALICE", hardwareIdKind: "mac", hardwareId: MAC_A }, C, T), { result: "linked" });
  assert.equal(row(db, alicePairing).physicalDeviceId, deviceId);
  assert.deepEqual(await linkPairing(db as never, ALICE, { peripheralId: "PERIPHERAL-ALICE", hardwareIdKind: "mac", hardwareId: MAC_A }, C, T), { result: "already_linked" });
  // Bob's phone discovers and pairs Alice's Band: nothing of Alice's changes, nothing is granted.
  await paired(db, BOB, "PERIPHERAL-BOB");
  assert.deepEqual(await linkPairing(db as never, BOB, { peripheralId: "PERIPHERAL-BOB", hardwareIdKind: "mac", hardwareId: MAC_A }, C, T), { result: "owned_by_another_account" });
  assert.deepEqual([ownerships(db).length, row(db, deviceId).ownerUserId, bandFor(db, BOB, 1)], [1, ALICE, false]);
  // A pairing on someone else's account / an unregistered (e.g. test) Band / a non-MAC.
  assert.deepEqual(await linkPairing(db as never, BOB, { peripheralId: "PERIPHERAL-ALICE", hardwareIdKind: "mac", hardwareId: MAC_A }, C, T), { result: "not_paired_on_this_account" });
  assert.deepEqual(await linkPairing(db as never, ALICE, { peripheralId: "PERIPHERAL-ALICE", hardwareIdKind: "mac", hardwareId: "02:00:5E:99:99:99" }, C, T), { result: "not_registered" });
  assert.deepEqual(await linkPairing(db as never, ALICE, { peripheralId: "PERIPHERAL-ALICE", hardwareIdKind: "mac", hardwareId: "G69" }, C, T), { result: "invalid_identifier" });
});

test("disconnect, reconnect and a new pairing leave ownership exactly as it was", async () => {
  const db = new MemoryDb();
  const { code, deviceId } = await ready(db);
  await activate(db, ALICE, code);
  const before = structuredClone(ownerships(db));
  const p = await paired(db, ALICE, "PERIPHERAL-1");
  await db.patch(p as string, { lastConnectedAt: T + 5 * DAY });           // reconnect
  await paired(db, ALICE, "PERIPHERAL-NEW-PHONE");                          // a second phone
  await linkPairing(db as never, ALICE, { peripheralId: "PERIPHERAL-NEW-PHONE", hardwareIdKind: "mac", hardwareId: MAC_A }, C, T);
  assert.deepEqual(ownerships(db), before);
  assert.equal(row(db, deviceId).status, "activated");
});

// ─── Replacement ─────────────────────────────────────────────────────────────

test("replacement: the new unit takes over on activation — one active Band, the original's history kept", async () => {
  const db = new MemoryDb();
  const orig = await ready(db, MAC_A);
  await activate(db, ALICE, orig.code);
  const repFul = await fulfil(db, orig.orderId, { kind: "replacement", replaces: orig.fulfillmentId, delivered: true });
  const rep = await unit(db, MAC_R);
  await assert.rejects(assignDevice(db as never, { deviceId: rep.deviceId, fulfillmentId: repFul }, T), /must name the device it replaces/);
  await assignDevice(db as never, { deviceId: rep.deviceId, fulfillmentId: repFul, replacesDeviceId: orig.deviceId }, T);
  assert.equal(bandFor(db, ALICE), true, "still the original until the replacement is activated");
  assert.equal((await activate(db, ALICE, rep.code)).ok, true);
  const active = ownerships(db).filter((o) => o.status === "activated");
  assert.equal(active.length, 1, "never two active Bands for one");
  assert.equal(active[0].deviceId, rep.deviceId);
  const old = ownerships(db).find((o) => o.deviceId === orig.deviceId)!;
  assert.equal(old.status, "replaced");
  assert.deepEqual((old.history as Array<{ status: string }>).map((h) => h.status), ["activated", "replaced"]);
  assert.equal(row(db, orig.deviceId).status, "replaced");
  assert.ok(db.get(orig.deviceId as string), "the original device record is never deleted");
  assert.ok(db.rows("commerceEvents").some((e) => e.name === "device_replaced"));
});

// ─── Returns ─────────────────────────────────────────────────────────────────

async function returned(db: MemoryDb, cfg: CommerceConfig = C) {
  const r = await ready(db);
  await activate(db, ALICE, r.code);
  const { returnId } = await requestReturn(db as never, ALICE, { orderId: r.orderId as never, requestKey: "return-device-0001", reason: "changed_mind", attestUnused: true }, cfg, T + 3 * DAY);
  return { ...r, returnId };
}

test("returns: a request doesn't end ownership; staff receipt of the named unit does (default policy)", async () => {
  const db = new MemoryDb();
  const { returnId, deviceId, orderId } = await returned(db);
  assert.equal(bandFor(db, ALICE), true, "return requested → still owned");
  await authorizeReturn(db as never, returnId, T);
  assert.equal(bandFor(db, ALICE), true, "authorized → still owned");
  const other = await unit(db, MAC_B);
  await assert.rejects(receiveReturn(db as never, STAFF, returnId, "unused", C, T + 5 * DAY, [other.deviceId]), /isn't from this order/);
  await receiveReturn(db as never, STAFF, returnId, "unused", C, T + 5 * DAY, [deviceId]);
  assert.deepEqual([row(db, deviceId).status, ownerships(db)[0].status, bandFor(db, ALICE)], ["returned", "returned", false]);
  assert.equal(row(db, returnId).deviceIds?.toString(), [deviceId].toString());
  assert.equal(row(db, orderId).paymentStatus, "paid", "the refund is still the provider's to confirm");
});

test("returns: with the 'refunded' policy, ownership ends only when the refund is verified", async () => {
  const db = new MemoryDb();
  const cfg: CommerceConfig = structuredClone(C); cfg.devices.ownershipEndsOnReturnAt = "refunded";
  const { returnId, deviceId, orderId } = await returned(db, cfg);
  await authorizeReturn(db as never, returnId, T);
  await receiveReturn(db as never, STAFF, returnId, "unused", cfg, T + 5 * DAY, [deviceId]);
  assert.equal(row(db, deviceId).status, "activated");
  await db.patch(returnId as string, { status: "refund_approved", refund: { amountCents: 10000, currency: "USD", approvedAt: T, approvedByUserId: STAFF, idempotencyKey: "refund:x" } });
  await db.patch(orderId as string, { returnStatus: "received" });
  await completeRefund(db as never, orderId as never, 10000, cfg, T + 6 * DAY);
  assert.deepEqual([row(db, deviceId).status, ownerships(db)[0].status], ["returned", "returned"]);
});

// ─── Staff ───────────────────────────────────────────────────────────────────

test("staff roles: store managers register and assign; only owner/admin activate, deactivate, retire, reissue or see full ids", () => {
  const u = (roles: string[]) => ({ roles }) as never;
  assert.ok(staffMay(u(["store_manager"]), "fulfillment"));
  assert.ok(!staffMay(u(["store_manager"]), "device_admin"));
  assert.ok(staffMay(u(["admin"]), "device_admin") && staffMay(u(["owner"]), "device_admin"));
  assert.ok(!staffMay(u(["client"]), "fulfillment") && !staffMay(u(["coach"]), "device_admin"));
  const src = readFileSync(join(import.meta.dirname, "../../convex/commerce/staffDevices.ts"), "utf8");
  for (const fn of ["reissueActivationCode", "activateForCustomer", "deactivateDevice", "retireDevice", "inspectDevice", "storeReissuedCode"]) {
    const body = src.slice(src.indexOf(`export const ${fn} =`), src.indexOf(`export const ${fn} =`) + 600);
    assert.match(body, /"device_admin"/, `${fn} needs owner/admin`);
  }
  for (const fn of ["registerDevice", "assignDevice", "unassignDevice", "devicesFor", "storeRegistration"]) {
    const body = src.slice(src.indexOf(`export const ${fn} =`), src.indexOf(`export const ${fn} =`) + 600);
    assert.match(body, /"fulfillment"/, `${fn} checks staff`);
  }
  const list = src.slice(src.indexOf("export const devicesFor"), src.indexOf("export const inspectDevice"));
  assert.match(list, /redactHardwareId\(d\.hardwareId\)/, "store managers see redacted identifiers");
});

test("staff handover activation needs a paid order of that customer; deactivation ends ownership with history", async () => {
  const db = new MemoryDb();
  const { orderId } = await paidOrder(db);
  const fulfillmentId = await fulfil(db, orderId);   // not carrier-delivered
  const { deviceId } = await unit(db, MAC_A);
  await assignDevice(db as never, { deviceId, fulfillmentId }, T);
  assert.deepEqual(await staffActivate(db as never, deviceId, BOB, C, T), { ok: false, reason: "not_eligible_for_account" }, "staff can't hand Alice's unit to Bob");
  assert.equal((await staffActivate(db as never, deviceId, ALICE, C, T)).ok, true);
  assert.equal(ownerships(db)[0].history[0].reason, "in_person_handover");
  await deactivateDevice(db as never, deviceId, "fraud_or_security", C, T + DAY);
  assert.deepEqual([row(db, deviceId).status, ownerships(db)[0].status, bandFor(db, ALICE)], ["deactivated", "deactivated", false]);
  assert.deepEqual((row(db, deviceId).history as Array<{ status: string }>).map((h) => h.status), ["registered", "assigned", "activated", "deactivated"]);
});

test("account deletion never leaves a device activated to a deleted account", async () => {
  const db = new MemoryDb();
  const { code, deviceId } = await ready(db);
  await activate(db, ALICE, code);
  await releaseDevicesOnAccountDeletion(db as never, ALICE, T + 9 * DAY);
  assert.deepEqual([row(db, deviceId).status, row(db, deviceId).ownerUserId], ["deactivated", undefined]);
  assert.equal(db.rows("commerceActivationAttempts").filter((a) => a.userId === ALICE).length, 0);
});

// ─── Privacy & boundaries ────────────────────────────────────────────────────

test("privacy: no hardware id, code or address in analytics; customer API shows redacted ids only; nothing logged", async () => {
  const db = new MemoryDb();
  const { code } = await ready(db);
  await activate(db, ALICE, "0000-0000-0000");
  await activate(db, ALICE, code);
  for (const e of db.rows("commerceEvents")) {
    const json = JSON.stringify(e);
    assert.ok(!/02:00:5E|00:0A|000A|Test Street|Colombo/i.test(json) && !json.includes(code.slice(0, 4)), `${e.name} leaks an identifier`);
  }
  const read = (f: string) => readFileSync(join(import.meta.dirname, "../../convex/commerce", f), "utf8");
  const my = read("myDevices.ts");
  const list = my.slice(my.indexOf("export const myDevices"), my.indexOf("export const linkPairing"));
  assert.match(list, /identifier: redactHardwareId\(d\.hardwareId\)/);
  assert.ok(!/hardwareId: d\.hardwareId|activationCodeHash/.test(list));
  for (const f of ["devices.ts", "deviceStore.ts", "myDevices.ts", "staffDevices.ts"]) assert.ok(!/console\.(log|info|warn|error|debug)/.test(read(f)), `${f} logs`);
});

test("customer API can't send ownership, eligibility, an owner or a device to activate; devices code isn't Band-specific", () => {
  const read = (f: string) => readFileSync(join(import.meta.dirname, "../../convex/commerce", f), "utf8");
  const my = read("myDevices.ts");
  const fns = [...my.matchAll(/export const (\w+) = (mutation|query|action)\(/g)].map((m) => `${m[1]}:${m[2]}`).sort();
  assert.deepEqual(fns, ["activateDevice:action", "linkPairing:mutation", "myDevices:query"]);
  const args = [...my.matchAll(/export const \w+ = (?:mutation|query|action)\(\{\s*args: \{([^}]*)\}/g)].map((m) => m[1]).join(" ");
  assert.ok(!/userId|owner|eligible|deviceId|orderId|status|ownership/i.test(args), `customer args: ${args}`);
  for (const f of ["devices.ts", "deviceStore.ts"]) {
    const src = read(f).replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(!/SOMBREY_BAND_V1|"sombrey_band"|G69/.test(src), `${f} hard-codes a product or a Bluetooth name`);
  }
});
