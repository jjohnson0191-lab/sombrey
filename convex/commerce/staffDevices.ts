// Sombrey commerce — Phase 6G: staff operations on physical devices (backend for
// the future Owner Dashboard; no UI here).
//
// Roles (staffAccess.ts): store_manager, admin, owner — register a unit (its
// hardware id; the one-time activation code is generated here and shown ONCE
// for printing), assign/unassign it to a fulfilment, list devices with
// REDACTED ids. Owner/admin only ("device_admin") — reissue a code, activate
// for a customer at an in-person handover, deactivate, retire, inspect full
// identifiers. Customers can't reach any of this; every change is in the
// device's and the ownership's history.

import { ConvexError, v } from "convex/values";
import { action, internalMutation, mutation, query } from "../_generated/server";
import { internal } from "../_generated/api";
import { COMMERCE_CONFIG } from "./config";
import { hardwareIdKind } from "./validators";
import { generateActivationCode, hashActivationCode, normalizeActivationCode, redactHardwareId } from "./devices";
import { assignDevice as assignDeviceRecord, deactivateDevice as deactivateDeviceRecord, registerDevice as registerDeviceRecord, reissueCode, retireDevice as retireDeviceRecord, staffActivate, unassignDevice as unassignDeviceRecord } from "./deviceStore";
import { requireStaff } from "./staff";

/** A fresh code from cryptographic randomness (actions only) and its hash. */
async function newCode() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const code = generateActivationCode(bytes);
  return { code, hash: await hashActivationCode(normalizeActivationCode(code)!) };
}

/** Register a real unit. Returns the activation code ONCE — print it and pack it with the device. */
export const registerDevice = action({
  args: { productId: v.string(), hardwareIdKind, hardwareId: v.string(), hardwareRevision: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ deviceId: string; activationCode: string }> => {
    await ctx.runQuery(internal.commerce.staff.checkStaff, { level: "fulfillment" });
    const { code, hash } = await newCode();
    const r = await ctx.runMutation(internal.commerce.staffDevices.storeRegistration, { ...args, activationCodeHash: hash });
    return { deviceId: r.deviceId, activationCode: code };
  },
});

/** Owner/admin: a new code for an unactivated unit (the old one stops working). */
export const reissueActivationCode = action({
  args: { deviceId: v.id("commerceDevices") },
  handler: async (ctx, args): Promise<{ activationCode: string }> => {
    await ctx.runQuery(internal.commerce.staff.checkStaff, { level: "device_admin" });
    const { code, hash } = await newCode();
    await ctx.runMutation(internal.commerce.staffDevices.storeReissuedCode, { deviceId: args.deviceId, activationCodeHash: hash });
    return { activationCode: code };
  },
});

export const assignDevice = mutation({
  args: { deviceId: v.id("commerceDevices"), fulfillmentId: v.id("commerceFulfillments"), replacesDeviceId: v.optional(v.id("commerceDevices")) },
  handler: async (ctx, args) => {
    await requireStaff(ctx, "fulfillment");
    return await assignDeviceRecord(ctx.db, args, Date.now());
  },
});

export const unassignDevice = mutation({
  args: { deviceId: v.id("commerceDevices") },
  handler: async (ctx, args) => {
    await requireStaff(ctx, "fulfillment");
    return await unassignDeviceRecord(ctx.db, args.deviceId, Date.now());
  },
});

/** Owner/admin: activate for a customer after an in-person handover (delivery
 * need not be carrier-confirmed; payment and order ownership still are). */
export const activateForCustomer = mutation({
  args: { deviceId: v.id("commerceDevices"), userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireStaff(ctx, "device_admin");
    const r = await staffActivate(ctx.db, args.deviceId, args.userId, COMMERCE_CONFIG, Date.now());
    return r.ok ? { ok: true as const, alreadyActive: r.alreadyActive } : r;
  },
});

export const deactivateDevice = mutation({
  args: { deviceId: v.id("commerceDevices"), reason: v.union(v.literal("fraud_or_security"), v.literal("staff_correction"), v.literal("warranty_exchange"), v.literal("other")) },
  handler: async (ctx, args) => {
    await requireStaff(ctx, "device_admin");
    return await deactivateDeviceRecord(ctx.db, args.deviceId, args.reason, COMMERCE_CONFIG, Date.now());
  },
});

export const retireDevice = mutation({
  args: { deviceId: v.id("commerceDevices"), reason: v.union(v.literal("damaged"), v.literal("lost"), v.literal("end_of_life"), v.literal("registration_error")) },
  handler: async (ctx, args) => {
    await requireStaff(ctx, "device_admin");
    return await retireDeviceRecord(ctx.db, args.deviceId, args.reason, Date.now());
  },
});

/** Devices of an order or fulfilment — identifiers REDACTED (any fulfilment staff). */
export const devicesFor = query({
  args: { orderId: v.optional(v.id("commerceOrders")), fulfillmentId: v.optional(v.id("commerceFulfillments")) },
  handler: async (ctx, args) => {
    await requireStaff(ctx, "fulfillment");
    if (!args.orderId === !args.fulfillmentId) throw new ConvexError({ code: "INVALID", message: "Give an order or a fulfilment" });
    const rows = args.orderId
      ? await ctx.db.query("commerceDevices").withIndex("by_order", (q) => q.eq("orderId", args.orderId)).collect()
      : await ctx.db.query("commerceDevices").withIndex("by_fulfillment", (q) => q.eq("fulfillmentId", args.fulfillmentId)).collect();
    return rows.map((d) => ({
      deviceId: d._id, productId: d.productId, generation: d.generation, status: d.status, hardwareIdKind: d.hardwareIdKind,
      hardwareId: redactHardwareId(d.hardwareId), fulfillmentId: d.fulfillmentId ?? null, replacesDeviceId: d.replacesDeviceId ?? null,
      owned: d.status === "activated", activatedAt: d.activatedAt ?? null,
    }));
  },
});

/** Owner/admin: one device in full (identifier, owner, history) — to resolve mismatches. */
export const inspectDevice = query({
  args: { deviceId: v.id("commerceDevices") },
  handler: async (ctx, args) => {
    await requireStaff(ctx, "device_admin");
    const d = await ctx.db.get(args.deviceId);
    if (!d) throw new ConvexError({ code: "NOT_FOUND", message: "Device not found" });
    const { activationCodeHash: _hash, ...rest } = d;
    const ownerships = await ctx.db.query("bandOwnership").withIndex("by_device", (q) => q.eq("deviceId", d._id)).collect();
    return { device: { ...rest, hasActivationCode: _hash !== undefined }, ownerships };
  },
});

// ─── Internal steps of the actions above (the caller's identity carries through) ──

export const storeRegistration = internalMutation({
  args: { productId: v.string(), hardwareIdKind, hardwareId: v.string(), hardwareRevision: v.optional(v.string()), activationCodeHash: v.string() },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx, "fulfillment");
    return await registerDeviceRecord(ctx.db, { ...args, staffUserId: staff._id }, COMMERCE_CONFIG, Date.now());
  },
});

export const storeReissuedCode = internalMutation({
  args: { deviceId: v.id("commerceDevices"), activationCodeHash: v.string() },
  handler: async (ctx, args) => {
    await requireStaff(ctx, "device_admin");
    await reissueCode(ctx.db, args.deviceId, args.activationCodeHash, Date.now());
    return null;
  },
});
