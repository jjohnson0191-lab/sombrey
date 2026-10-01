// Sombrey commerce, Phase 6J — the provider-facing orchestration of the commerce
// actions, as plain functions.
//
// Each Convex action (checkout:beginPayment, staff:submitFulfillment,
// staff:refreshTracking, staff:createReturnLabel, staff:issueRefund) is a thin
// wrapper: it checks the caller, picks the configured provider (none today) and
// runs the matching flow here with its own queries/mutations as the steps. The
// webhook flows are what an HTTP route will run once a provider is chosen —
// there is no route today, because there is no provider.
//
// Being plain functions, the flows run in the Node tests against TEST-ONLY
// provider adapters (tests/commerce/testProviders.ts) — the same code the
// actions run, never a copy. Every provider call goes through callProvider
// (bounded, shape-checked); every provider reply is normalized before it
// reaches a mutation.

import { callProvider, type FulfillmentProvider, type PaymentProvider, type Providers, type VerifiedPaymentEvent } from "./providers.ts";
import { computeQuote, type DraftForQuote, type OrderQuote } from "./quotes.ts";
import type { CommerceConfig } from "./config.ts";
import { normalizeCreatedShipment, normalizeProviderShipmentEvent } from "./fulfillment.ts";
import type { ShippingAddress } from "./orders.ts";

type Log = (event: string, fields: Record<string, unknown>, level?: "info" | "warn") => void;
const quiet: Log = () => undefined;

// ─── Quote ───────────────────────────────────────────────────────────────────

/** Shipping + tax for a checkout (a quote made seconds ago is reused, 6I). */
export async function requestQuoteFlow(d: {
  draft: () => Promise<DraftForQuote & { recentQuote: OrderQuote | null }>;
  providers: Providers;
  config: CommerceConfig;
  now: number;
  quoteId: string;
  store: (quote: OrderQuote) => Promise<unknown>;
  timeoutMs?: number;
}): Promise<OrderQuote> {
  const draft = await d.draft();
  if (draft.recentQuote) return draft.recentQuote;
  const quote = await computeQuote(draft, d.providers, d.config, d.now, d.quoteId, d.config.version, d.timeoutMs);
  await d.store(quote);
  return quote;
}

// ─── Payment ─────────────────────────────────────────────────────────────────

export type BeginPaymentResult =
  | { status: "ready"; provider: string; clientHandoff: Record<string, string> }
  | { status: "payment_unavailable" | "quote_missing" | "quote_expired" | "quote_incomplete" | "payment_in_progress" | "not_open" | "checkout_outdated" | "already_paid" };

type Reservation =
  | { kind: "new" | "existing"; orderNumber: string; attempt: { amountCents: number; currency: string; idempotencyKey: string } }
  | { kind: "refused"; reason: "quote_missing" | "quote_expired" | "quote_incomplete" | "payment_in_progress" | "not_open" | "checkout_outdated" | "already_paid" };

export async function beginPaymentFlow(d: {
  payment: PaymentProvider | null;
  methods: string[];
  reserve: (provider: string) => Promise<Reservation>;
  attach: (idempotencyKey: string, providerRef: string) => Promise<unknown>;
  timeoutMs?: number;
}): Promise<BeginPaymentResult> {
  // No provider is integrated: nothing is reserved, nothing is charged.
  if (!d.payment) return { status: "payment_unavailable" };
  const payment = d.payment;
  const r = await d.reserve(payment.name);
  if (r.kind === "refused") return { status: r.reason };
  const session = await callProvider(() => payment.createSession({
    orderNumber: r.orderNumber, amountCents: r.attempt.amountCents, currency: r.attempt.currency,
    idempotencyKey: r.attempt.idempotencyKey, methods: [...d.methods],
  }), d.timeoutMs);
  // The attempt stays reserved: a retry uses the same idempotency key, so the
  // provider returns the same session rather than a second charge.
  if (!session.ok || typeof session.providerRef !== "string" || !session.providerRef) return { status: "payment_unavailable" };
  await d.attach(r.attempt.idempotencyKey, session.providerRef);
  return { status: "ready", provider: payment.name, clientHandoff: session.clientHandoff ?? {} };
}

/** Which order a verified payment event belongs to: the attempt key Sombrey gave
 * the provider is `${orderId}:${quoteId}` and is echoed in the signed event.
 * An event without it can't be matched (and is never guessed). */
export function orderIdFromAttemptKey(idempotencyKey: string | undefined): string | null {
  if (typeof idempotencyKey !== "string") return null;
  const i = idempotencyKey.lastIndexOf(":");
  return i > 0 ? idempotencyKey.slice(0, i) : null;
}

export type PaymentWebhookResult = { status: "rejected_signature" | "unmatched" } | { status: "processed"; outcome: string; reason?: string };

/** A payment webhook: verify (signature + replay window, in the adapter), match
 * to its order by the echoed attempt key, apply once. */
export async function paymentWebhookFlow(d: {
  payment: PaymentProvider;
  rawBody: string;
  headers: Record<string, string>;
  apply: (orderId: string, event: VerifiedPaymentEvent) => Promise<{ outcome: string; reason?: string }>;
  log?: Log;
}): Promise<PaymentWebhookResult> {
  const log = d.log ?? quiet;
  const event = await d.payment.verifyWebhook(d.rawBody, d.headers).catch(() => null);
  if (!event) { log("payment_webhook_rejected", { provider: d.payment.name }, "warn"); return { status: "rejected_signature" }; }
  const orderId = orderIdFromAttemptKey(event.idempotencyKey);
  if (!orderId) { log("payment_webhook_unmatched", { provider: d.payment.name, eventType: event.type }, "warn"); return { status: "unmatched" }; }
  const r = await d.apply(orderId, event);
  if (r.outcome !== "applied" && r.outcome !== "duplicate" && r.outcome !== "unchanged") log("payment_event_not_applied", { provider: d.payment.name, outcome: r.outcome, reason: r.reason ?? null }, "warn");
  return { status: "processed", ...r };
}

/** Owner/admin: ask the provider to refund an approved return. A request only —
 * the return is refunded when the provider's VERIFIED refund event arrives. */
export async function issueRefundFlow(d: {
  payment: PaymentProvider | null;
  job: () => Promise<{ providerRef: string; amountCents: number; currency: string; idempotencyKey: string }>;
  markRequested: (refundRef: string) => Promise<unknown>;
  timeoutMs?: number;
}): Promise<{ status: "requested" | "refund_unavailable" | "provider_refused" }> {
  if (!d.payment) return { status: "refund_unavailable" };
  const payment = d.payment;
  const job = await d.job();
  const r = await callProvider(() => payment.refund(job), d.timeoutMs);
  if (!r.ok || typeof r.refundRef !== "string" || !r.refundRef) return { status: "provider_refused" };
  await d.markRequested(r.refundRef);
  return { status: "requested" };
}

// ─── Fulfilment ──────────────────────────────────────────────────────────────

type ShipmentJob = { orderNumber: string; address: ShippingAddress; items: Array<{ productId: string; sku: string; quantity: number }> };

/** Send a fulfilment to the provider. A retry after a lost response either finds
 * it already submitted, or asks again with the SAME key (same shipment). */
export async function submitFulfillmentFlow(d: {
  provider: FulfillmentProvider | null;
  fulfillmentId: string;
  job: () => Promise<({ alreadySubmitted: true }) | ({ alreadySubmitted: false } & ShipmentJob)>;
  record: (idempotencyKey: string, created: NonNullable<ReturnType<typeof normalizeCreatedShipment>>) => Promise<unknown>;
  log?: Log;
  timeoutMs?: number;
}): Promise<{ status: "submitted" | "fulfillment_unavailable" | "provider_refused" }> {
  if (!d.provider) return { status: "fulfillment_unavailable" };
  const provider = d.provider;
  const job = await d.job();
  if (job.alreadySubmitted) return { status: "submitted" };
  const idempotencyKey = `ship:${d.fulfillmentId}:1`;
  const raw = await callProvider(() => provider.createShipment({ idempotencyKey, orderNumber: job.orderNumber, direction: "outbound", address: job.address, items: job.items }), d.timeoutMs);
  const created = normalizeCreatedShipment(raw);
  if (!created) {
    (d.log ?? quiet)("fulfillment_submit_refused", { fulfillmentId: d.fulfillmentId, provider: provider.name, reason: raw && !(raw as { ok?: boolean }).ok ? (raw as { reason?: string }).reason ?? "provider_error" : "malformed_response" }, "warn");
    return { status: "provider_refused" };
  }
  await d.record(idempotencyKey, created);
  return { status: "submitted" };
}

/** A prepaid return label for an authorized return (same key on every retry). */
export async function returnLabelFlow(d: {
  provider: FulfillmentProvider | null;
  returnId: string;
  job: () => Promise<ShipmentJob>;
  record: (idempotencyKey: string, created: NonNullable<ReturnType<typeof normalizeCreatedShipment>>) => Promise<unknown>;
  timeoutMs?: number;
}): Promise<{ status: "created" | "returns_unavailable" | "provider_refused" }> {
  if (!d.provider) return { status: "returns_unavailable" };
  const provider = d.provider;
  const job = await d.job();
  const idempotencyKey = `return:${d.returnId}:1`;
  const created = normalizeCreatedShipment(await callProvider(() => provider.createShipment({ idempotencyKey, orderNumber: job.orderNumber, direction: "return", address: job.address, items: job.items }), d.timeoutMs));
  if (!created) return { status: "provider_refused" };
  await d.record(idempotencyKey, created);
  return { status: "created" };
}

type ShipmentEventApply = (event: NonNullable<ReturnType<typeof normalizeProviderShipmentEvent>>) => Promise<{ outcome: string }>;

/** Recovery after missed webhooks: the provider's events for one shipment,
 * each normalized; a malformed or foreign event is skipped on its own. */
export async function refreshTrackingFlow(d: {
  provider: FulfillmentProvider | null;
  shipmentId: string;
  shipmentRef: () => Promise<string>;
  apply: ShipmentEventApply;
  log?: Log;
  timeoutMs?: number;
}): Promise<{ status: "refreshed" | "tracking_unavailable" | "provider_refused"; applied?: number; skipped?: number }> {
  if (!d.provider) return { status: "tracking_unavailable" };
  const provider = d.provider;
  const ref = await d.shipmentRef();
  const events = await callProvider(() => provider.getTracking(ref), d.timeoutMs);
  if (!Array.isArray(events)) return { status: "provider_refused" };
  let applied = 0, skipped = 0;
  for (const raw of events) {
    const event = normalizeProviderShipmentEvent(raw);
    if (!event || event.providerRef !== ref) { skipped++; continue; }
    if ((await d.apply(event)).outcome === "applied") applied++;
  }
  if (skipped) (d.log ?? quiet)("tracking_events_skipped", { shipmentId: d.shipmentId, provider: provider.name, skipped, applied }, "warn");
  return { status: "refreshed", applied, skipped };
}

/** A shipment webhook: verify (in the adapter), then apply each normalized event. */
export async function shipmentWebhookFlow(d: {
  provider: FulfillmentProvider;
  rawBody: string;
  headers: Record<string, string>;
  apply: ShipmentEventApply;
}): Promise<{ status: "rejected_signature" } | { status: "processed"; outcomes: string[] }> {
  const events = await d.provider.verifyWebhook(d.rawBody, d.headers).catch(() => null);
  if (!Array.isArray(events)) return { status: "rejected_signature" };
  const outcomes: string[] = [];
  for (const raw of events) {
    const event = normalizeProviderShipmentEvent(raw);
    outcomes.push(event ? (await d.apply(event)).outcome : "malformed");
  }
  return { status: "processed", outcomes };
}
