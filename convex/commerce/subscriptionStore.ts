// Sombrey commerce — the ONE writer of App Store subscription records.
//
// Phase 6A defined the rules (subscriptionState.ts) and the backend-only
// mutation (internal.ts applyVerifiedSubscription). Phase 6C moves that
// mutation's body here, unchanged in purpose, so the two trusted callers share
// it instead of duplicating it:
//   • internal.applyVerifiedSubscription  ← app submissions verified with Apple
//   • internal.applyAppStoreNotification  ← verified App Store Server Notifications
// Both are internal mutations (no client can call them) and each runs as one
// serializable Convex transaction — so check-then-write here is atomic:
// concurrent deliveries of the same transaction or notification can't create
// two records (Convex has no unique indexes; this is how uniqueness holds).
//
// Tested against an in-memory database in tests/commerce/appStoreStore.test.ts.

import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { applyVerifiedUpdate, validateVerifiedUpdate, type SubscriptionRecord, type VerificationMethod, type VerifiedSubscriptionUpdate } from "./subscriptionState.ts";
import { commerceEventFor, type HistoryEvent } from "./appStoreRules.ts";
import { validateEvent } from "./events.ts";

type Db = MutationCtx["db"];

export type SubscriptionSource =
  | { kind: "app_submission" }
  | { kind: "server_notification"; notificationUUID: string; notificationType: string; subtype?: string };

export type WriteResult = { result: "created" | "updated" | "unchanged" | "stale"; subscriptionId: Id<"commerceSubscriptions"> | null };

export type StoreConfig = {
  /** Sombrey's product id (config.ts products.membership.id). */
  membershipProductId: string;
  /** Accepted App Store product ids (config.ts appStoreProductId; empty = not configured). */
  appStoreProductIds: string[];
  configVersion: string;
};

export function toSubscriptionRecord(s: Doc<"commerceSubscriptions">): SubscriptionRecord {
  return {
    provider: s.provider, environment: s.environment, appStoreProductId: s.appStoreProductId,
    originalTransactionId: s.originalTransactionId, latestTransactionId: s.latestTransactionId,
    status: s.status, autoRenewEnabled: s.autoRenewEnabled, purchaseDate: s.purchaseDate, expiresDate: s.expiresDate,
    signedDate: s.signedDate, ...(s.revocationDate !== undefined ? { revocationDate: s.revocationDate } : {}),
    ...(s.gracePeriodExpiresDate !== undefined ? { gracePeriodExpiresDate: s.gracePeriodExpiresDate } : {}),
    ...(s.appAccountToken !== undefined ? { appAccountToken: s.appAccountToken } : {}),
    lastVerifiedAt: s.lastVerifiedAt, verificationMethod: s.verificationMethod as VerificationMethod,
  };
}

/** App Store submissions verified per account per hour (each one is an App
 * Store Server API request made with Sombrey's key). Beyond it: retry later. */
export const SUBMISSIONS_PER_HOUR = 30;

/** Records which Sombrey account an appAccountToken belongs to (derived on the
 * server from the authenticated user — never from client input). With
 * `countSubmission`, also takes one submission from the account's hourly budget. */
export async function linkAccountToken(db: Db, userId: Id<"users">, appAccountToken: string, now: number,
  opts: { countSubmission?: boolean } = {}): Promise<{ allowed: boolean }> {
  const rows = await db.query("commerceAppAccountTokens").withIndex("by_token", (q) => q.eq("appAccountToken", appAccountToken)).take(2);
  if (rows.some((r) => r.userId !== userId)) throw new ConvexError({ code: "FORBIDDEN", message: "Account token conflict" });
  const row = rows[0];
  if (!opts.countSubmission) {
    if (!row) await db.insert("commerceAppAccountTokens", { userId, appAccountToken, createdAt: now });
    return { allowed: true };
  }
  const fresh = !row?.submissionWindowStart || now - row.submissionWindowStart >= 3_600_000;
  const count = fresh ? 0 : row?.submissionCount ?? 0;
  if (count >= SUBMISSIONS_PER_HOUR) return { allowed: false };
  const window = { submissionWindowStart: fresh ? now : row!.submissionWindowStart!, submissionCount: count + 1 };
  if (row) await db.patch(row._id, window);
  else await db.insert("commerceAppAccountTokens", { userId, appAccountToken, createdAt: now, ...window });
  return { allowed: true };
}

export async function userForAccountToken(db: Db, appAccountToken: string): Promise<Id<"users"> | null> {
  const row = await db.query("commerceAppAccountTokens").withIndex("by_token", (q) => q.eq("appAccountToken", appAccountToken)).first();
  return row?.userId ?? null;
}

/** Apply a VERIFIED update for a user: validate, bind to the account, write the
 * current state, append history, record the server event. Idempotent: the same
 * state again (or older signed data) writes no history. */
export async function writeVerifiedSubscription(db: Db, args: {
  userId: Id<"users">;
  update: VerifiedSubscriptionUpdate;
  event: HistoryEvent;
  source: SubscriptionSource;
}, config: StoreConfig, now: number): Promise<WriteResult> {
  const problem = validateVerifiedUpdate(args.update, config.appStoreProductIds);
  if (problem) throw new ConvexError({ code: "INVALID", message: problem });
  const existing = await db.query("commerceSubscriptions").withIndex("by_original_transaction", (q) => q.eq("originalTransactionId", args.update.originalTransactionId)).unique();
  if (existing && existing.userId !== args.userId) throw new ConvexError({ code: "FORBIDDEN", message: "That subscription belongs to another account" });
  let applied: ReturnType<typeof applyVerifiedUpdate>;
  try {
    applied = applyVerifiedUpdate(existing ? toSubscriptionRecord(existing) : null, args.update);
  } catch {
    throw new ConvexError({ code: "FORBIDDEN", message: "That subscription belongs to another account" });
  }
  const { changed, refreshed, record } = applied;
  if (!changed) {
    if (existing && refreshed) await db.patch(existing._id, { signedDate: record.signedDate, lastVerifiedAt: record.lastVerifiedAt, updatedAt: now });
    return { result: refreshed ? "unchanged" : "stale", subscriptionId: existing?._id ?? null };
  }
  let id: Id<"commerceSubscriptions">;
  if (existing) {
    // Optional facts Apple no longer reports (a reversed refund, a finished
    // grace period) are cleared, not left behind: undefined removes a field.
    await db.patch(existing._id, { revocationDate: undefined, gracePeriodExpiresDate: undefined, ...record, updatedAt: now });
    id = existing._id;
  } else {
    id = await db.insert("commerceSubscriptions", { userId: args.userId, productId: config.membershipProductId, ...record, createdAt: now, updatedAt: now });
  }
  const src = args.source;
  await db.insert("commerceSubscriptionHistory", {
    subscriptionId: id, userId: args.userId, latestTransactionId: record.latestTransactionId, status: record.status,
    expiresDate: record.expiresDate, signedDate: record.signedDate, verificationMethod: record.verificationMethod, recordedAt: now,
    event: args.event, source: src.kind, appStoreProductId: record.appStoreProductId, autoRenewEnabled: record.autoRenewEnabled,
    ...(record.revocationDate !== undefined ? { revocationDate: record.revocationDate } : {}),
    ...(record.gracePeriodExpiresDate !== undefined ? { gracePeriodExpiresDate: record.gracePeriodExpiresDate } : {}),
    ...(src.kind === "server_notification" ? { notificationUUID: src.notificationUUID, notificationType: src.notificationType, ...(src.subtype ? { notificationSubtype: src.subtype } : {}) } : {}),
  });
  const name = commerceEventFor(args.event, !existing, record.status);
  if (name && !validateEvent({ name, platform: "backend", productId: config.membershipProductId }, "server", [config.membershipProductId])) {
    await db.insert("commerceEvents", { name, userId: args.userId, at: now, origin: "server", platform: "backend", productId: config.membershipProductId, configVersion: config.configVersion });
  }
  return { result: existing ? "updated" : "created", subscriptionId: id };
}

export type NotificationIdentity = {
  notificationUUID: string;
  notificationType: string;
  subtype?: string;
  environment: "production" | "sandbox";
  signedDate: number;
};

export type NotificationOutcome = "applied" | "unchanged" | "stale" | "ignored" | "unmatched" | "rejected" | "duplicate";

/** A VERIFIED App Store Server Notification, recorded exactly once by its
 * notificationUUID and — when it describes a Sombrey subscription — applied
 * through writeVerifiedSubscription, all in one transaction. */
export async function applyNotification(db: Db, args: {
  notification: NotificationIdentity;
  /** Present when the notification carries a verified, checked subscription state. */
  apply?: { update: VerifiedSubscriptionUpdate; event: HistoryEvent };
  /** Why the verified notification is only recorded (unsupported type, failed checks). */
  skipped?: { outcome: "ignored" | "rejected"; reason: string; originalTransactionId?: string };
}, config: StoreConfig, now: number): Promise<{ outcome: NotificationOutcome }> {
  const n = args.notification;
  const seen = await db.query("commerceAppStoreNotifications").withIndex("by_uuid", (q) => q.eq("notificationUUID", n.notificationUUID)).first();
  if (seen) return { outcome: "duplicate" };
  const row = {
    notificationUUID: n.notificationUUID, notificationType: n.notificationType, ...(n.subtype ? { subtype: n.subtype } : {}),
    environment: n.environment, signedDate: n.signedDate, receivedAt: now,
  };
  if (!args.apply) {
    const s = args.skipped ?? { outcome: "ignored" as const, reason: "no_subscription_data" };
    await db.insert("commerceAppStoreNotifications", { ...row, outcome: s.outcome, reason: s.reason, ...(s.originalTransactionId ? { originalTransactionId: s.originalTransactionId } : {}) });
    return { outcome: s.outcome };
  }
  const u = args.apply.update;
  const existing = await db.query("commerceSubscriptions").withIndex("by_original_transaction", (q) => q.eq("originalTransactionId", u.originalTransactionId)).unique();
  const userId = existing?.userId ?? (u.appAccountToken ? await userForAccountToken(db, u.appAccountToken) : null);
  if (!userId) {
    // No Sombrey account has this token yet (e.g. Apple notified before the app
    // reported the purchase). Kept for audit; the app's submission records it.
    await db.insert("commerceAppStoreNotifications", { ...row, outcome: "unmatched", reason: "unknown_account_token", originalTransactionId: u.originalTransactionId });
    return { outcome: "unmatched" };
  }
  let outcome: NotificationOutcome, subscriptionId: Id<"commerceSubscriptions"> | null = null, reason: string | undefined;
  try {
    const w = await writeVerifiedSubscription(db, {
      userId, update: u, event: args.apply.event,
      source: { kind: "server_notification", notificationUUID: n.notificationUUID, notificationType: n.notificationType, ...(n.subtype ? { subtype: n.subtype } : {}) },
    }, config, now);
    outcome = w.result === "created" || w.result === "updated" ? "applied" : w.result;
    subscriptionId = w.subscriptionId;
  } catch (e) {
    if (!(e instanceof ConvexError)) throw e;
    outcome = "rejected";
    reason = (e.data as { code?: string })?.code === "FORBIDDEN" ? "wrong_account" : "invalid_update";
  }
  await db.insert("commerceAppStoreNotifications", {
    ...row, outcome, originalTransactionId: u.originalTransactionId, userId,
    ...(subscriptionId ? { subscriptionId } : {}), ...(reason ? { reason } : {}),
  });
  return { outcome };
}
