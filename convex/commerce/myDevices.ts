// Sombrey commerce — Phase 6G: a customer's physical devices.
//
//   activateDevice   the one-time code from the box → the server checks the code,
//                    the order (yours, paid), the delivery and the device's state,
//                    then records ownership. Retrying is safe (same result).
//   myDevices        your devices, current and past — product, status, dates and a
//                    redacted identifier only
//   linkPairing      after the app pairs a Band, link that pairing to the device
//                    you own (the Band's reported hardware id). Never creates or
//                    moves ownership; another account's Band is refused.
//
// The user always comes from the auth token. The app can't send ownership,
// eligibility, an owner, an order or a device id to activate.

import { ConvexError, v } from "convex/values";
import { action, internalMutation, mutation, query } from "../_generated/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { COMMERCE_CONFIG, physicalProduct } from "./config";
import { hardwareIdKind } from "./validators";
import { hashActivationCode, normalizeActivationCode, redactHardwareId, type ActivationRefusal } from "./devices";
import { activateWithCode, linkPairing as linkPairingRecord } from "./deviceStore";

async function requireUser(ctx: QueryCtx | MutationCtx): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });
  const user = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier)).unique();
  if (!user) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });
  return user;
}

export type ActivateResult = { status: "activated" | "already_active" } | { status: ActivationRefusal };

export const activateDevice = action({
  args: { activationCode: v.string() },
  handler: async (ctx, args): Promise<ActivateResult> => {
    const canonical = normalizeActivationCode(args.activationCode);
    // A malformed code still counts as an attempt (and is never sent anywhere).
    const codeHash = canonical ? await hashActivationCode(canonical) : "malformed";
    return await ctx.runMutation(internal.commerce.myDevices.activateForCaller, { codeHash });
  },
});

export const activateForCaller = internalMutation({
  args: { codeHash: v.string() },
  handler: async (ctx, args): Promise<ActivateResult> => {
    const user = await requireUser(ctx);
    const r = await activateWithCode(ctx.db, user._id, args.codeHash, COMMERCE_CONFIG, Date.now());
    return r.ok ? { status: r.alreadyActive ? "already_active" : "activated" } : { status: r.reason };
  },
});

export const myDevices = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const ownerships = (await ctx.db.query("bandOwnership").withIndex("by_user", (q) => q.eq("userId", user._id)).collect()).filter((o) => o.deviceId);
    const pairings = await ctx.db.query("wearableDevices").withIndex("by_user", (q) => q.eq("userId", user._id)).take(20);
    const out = [];
    for (const o of ownerships) {
      const d = await ctx.db.get(o.deviceId!);
      if (!d) continue;
      out.push({
        productName: physicalProduct(COMMERCE_CONFIG, d.productId)?.displayName ?? d.productId,
        generation: d.generation,
        identifier: redactHardwareId(d.hardwareId),
        status: o.status,                                   // activated | replaced | returned | deactivated
        activatedAt: o.activation?.activatedAt ?? null,
        endedAt: o.status === "activated" ? null : o.updatedAt,
        pairedOnThisAccount: pairings.some((p) => p.physicalDeviceId === d._id),
      });
    }
    return out;
  },
});

export const linkPairing = mutation({
  args: { peripheralId: v.string(), hardwareIdKind, hardwareId: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    return await linkPairingRecord(ctx.db, user._id, args, COMMERCE_CONFIG, Date.now());
  },
});
