// Sombrey commerce — Phase 6E: quotes and the customer-facing order stage (pure).
//
// A QUOTE is subtotal (the order's own price snapshot, from config.ts) +
// shipping (a real ShippingQuoteProvider) + tax (a real TaxQuoteProvider, for
// the destination, after shipping). Missing provider → that part is
// "unavailable" and the total stays null — never a guessed number. Quotes
// expire (config.checkout.quoteTtlMinutes, or sooner if a provider says so);
// payment can only start against a complete, unexpired quote.
//
// The ORDER STAGE is a read model over 6A's three state machines (payment,
// fulfilment, return — orders.ts), which stay the only source of truth:
//   draft → quote_ready → payment_pending → paid → fulfillment_pending →
//   shipped → delivered → return_requested → return_authorized →
//   return_in_transit → return_received → refunded  (+ cancelled, payment_failed,
//   delivery_failed). 6E moves orders up to "paid"; 6F (fulfillment.ts) moves
//   fulfilment, delivery and returns; ownership and activation are 6G.
//
// Pure — tested in tests/commerce/checkout.test.ts.

import { physicalProduct, type CommerceConfig } from "./config.ts";
import { orderTotal, type FulfillmentStatus, type OrderLine, type PaymentStatus, type ReturnStatus, type ShippingAddress } from "./orders.ts";
import { callProvider, type ProviderQuote, type ProviderRefusal, type Providers, type QuoteLine } from "./providers.ts";

export type QuoteUnavailableReason =
  | "provider_not_configured" | "no_service_to_destination" | "provider_error" | "invalid_request"
  | "currency_mismatch" | "invalid_amount" | "awaiting_shipping_quote";

export type ComponentQuote =
  | { status: "quoted"; amountCents: number; provider: string; reference: string; detail: string }
  | { status: "unavailable"; reason: QuoteUnavailableReason };

export type OrderQuote = {
  quoteId: string;
  complete: boolean;
  subtotalCents: number;
  shipping: ComponentQuote;
  tax: ComponentQuote;
  /** Known only when shipping AND tax are quoted. */
  totalCents: number | null;
  currency: string;
  configVersion: string;
  createdAt: number;
  expiresAt: number;
};

/** The largest single shipping or tax amount accepted from a provider ($100,000). */
export const MAX_PROVIDER_AMOUNT_CENTS = 10_000_000;

export type DraftForQuote = { lines: OrderLine[]; currency: string; subtotalCents: number; shippingAddress: ShippingAddress };

/** Is an unpaid draft still priced as the configuration prices it today? If the
 * Band's price, currency or availability changed, the customer starts again —
 * nothing is silently re-priced and no draft is charged at an old price. */
export function draftStillCurrent(d: DraftForQuote, config: CommerceConfig): boolean {
  if (d.currency !== config.currency) return false;
  return d.lines.every((l) => {
    const p = physicalProduct(config, l.productId);
    return !!p && p.active && l.unitPriceCents === p.priceCents && l.currency === p.currency
      && Number.isInteger(l.quantity) && l.quantity >= 1 && l.quantity <= p.maxQuantityPerOrder;
  }) && d.subtotalCents === d.lines.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0);
}

function component(r: ProviderQuote | ProviderRefusal, provider: string, currency: string): ComponentQuote {
  if (!r.ok) return { status: "unavailable", reason: r.reason };
  if (r.currency !== currency) return { status: "unavailable", reason: "currency_mismatch" };
  if (!Number.isSafeInteger(r.amountCents) || r.amountCents < 0 || r.amountCents > MAX_PROVIDER_AMOUNT_CENTS) return { status: "unavailable", reason: "invalid_amount" };
  return { status: "quoted", amountCents: r.amountCents, provider, reference: String(r.reference).slice(0, 120), detail: String(r.detail).slice(0, 80) };
}

/** 6J: a provider's own quote expiry is honoured only when it's a real future time. */
const validExpiry = (t: unknown, now: number): t is number => typeof t === "number" && Number.isFinite(t) && t > now;

/** Quotes a draft. Providers that throw, hang or reply malformed are treated as errors, not as zero. */
export async function computeQuote(d: DraftForQuote, providers: Providers, config: CommerceConfig, now: number, quoteId: string, configVersion: string, timeoutMs?: number): Promise<OrderQuote> {
  const lines: QuoteLine[] = d.lines.map((l) => ({ productId: l.productId, sku: physicalProduct(config, l.productId)?.sku ?? l.productId, quantity: l.quantity, unitPriceCents: l.unitPriceCents }));
  const destination = { countryCode: d.shippingAddress.countryCode, region: d.shippingAddress.region, postalCode: d.shippingAddress.postalCode, city: d.shippingAddress.city };
  const expiries = [now + config.checkout.quoteTtlMinutes * 60_000];
  let shipping: ComponentQuote = { status: "unavailable", reason: "provider_not_configured" };
  if (providers.shipping) {
    const sp = providers.shipping;
    const r = await callProvider(() => sp.quote({ destination, lines, currency: d.currency }), timeoutMs);
    shipping = component(r, sp.name, d.currency);
    if (shipping.status === "quoted" && r.ok && validExpiry(r.expiresAt, now)) expiries.push(r.expiresAt);
  }
  let tax: ComponentQuote = { status: "unavailable", reason: providers.tax ? "awaiting_shipping_quote" : "provider_not_configured" };
  if (providers.tax && shipping.status === "quoted") {
    const tp = providers.tax, shippingCents = shipping.amountCents;
    const r = await callProvider(() => tp.quote({ destination, lines, subtotalCents: d.subtotalCents, shippingCents, currency: d.currency }), timeoutMs);
    tax = component(r, tp.name, d.currency);
    if (tax.status === "quoted" && r.ok && validExpiry(r.expiresAt, now)) expiries.push(r.expiresAt);
  }
  const total = orderTotal(d.subtotalCents, shipping.status === "quoted" ? shipping.amountCents : null, tax.status === "quoted" ? tax.amountCents : null);
  const totalCents = total !== null && Number.isSafeInteger(total) ? total : null;
  return {
    quoteId, complete: totalCents !== null, subtotalCents: d.subtotalCents, shipping, tax, totalCents,
    currency: d.currency, configVersion, createdAt: now, expiresAt: Math.min(...expiries),
  };
}

/** 6I: a quote made in the last few seconds is returned again rather than
 * asking the shipping/tax providers anew — a double tap or a retry loop can't
 * flood the providers (or the analytics) with identical requests. The address
 * and lines can't have changed: changing either drops the stored quote. */
export const QUOTE_REUSE_MS = 10_000;
export function reusableQuote(q: OrderQuote | undefined | null, now: number, config: CommerceConfig): OrderQuote | null {
  if (!q || q.configVersion !== config.version) return null;
  return now >= q.createdAt && now - q.createdAt < QUOTE_REUSE_MS && now < q.expiresAt ? q : null;
}

/** A quote payment may start against. */
export function quoteUsable(q: OrderQuote | undefined | null, now: number): q is OrderQuote & { totalCents: number } {
  return !!q && q.complete && q.totalCents !== null && now < q.expiresAt;
}

export type OrderStage =
  | "draft" | "quote_ready" | "payment_pending" | "paid" | "payment_failed" | "cancelled"
  | "fulfillment_pending" | "shipped" | "delivered" | "delivery_failed"
  | "return_requested" | "return_authorized" | "return_in_transit" | "return_received" | "refunded";

export function orderStage(o: {
  paymentStatus: PaymentStatus; fulfillmentStatus: FulfillmentStatus; returnStatus: ReturnStatus;
  quote?: OrderQuote | null; paymentAttempt?: { startedAt: number } | null;
  /** 6F: the active return's own status, when there is one (finer than returnStatus). */
  activeReturn?: string | null;
}, now: number): OrderStage {
  if (o.paymentStatus === "refunded" || o.returnStatus === "refunded") return "refunded";
  if (o.paymentStatus === "cancelled") return "cancelled";
  if (o.paymentStatus === "failed") return "payment_failed";
  if (o.returnStatus === "received") return "return_received";
  if (o.returnStatus === "approved") return o.activeReturn === "in_transit" ? "return_in_transit" : "return_authorized";
  if (o.returnStatus === "requested") return "return_requested";
  if (o.paymentStatus === "paid" || o.paymentStatus === "partially_refunded") {
    if (o.fulfillmentStatus === "delivered") return "delivered";
    if (o.fulfillmentStatus === "shipped") return "shipped";
    if (o.fulfillmentStatus === "delivery_failed") return "delivery_failed";
    if (o.fulfillmentStatus === "processing") return "fulfillment_pending";
    return "paid";
  }
  if (o.paymentStatus === "authorized" || o.paymentAttempt) return "payment_pending";
  return quoteUsable(o.quote, now) ? "quote_ready" : "draft";
}
