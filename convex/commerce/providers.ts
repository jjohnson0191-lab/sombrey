// Sombrey commerce — Phase 6E: the provider boundary for physical checkout.
//
// Sombrey's order domain talks to three kinds of outside service through these
// interfaces only, so it never becomes coupled to one vendor:
//
//   ShippingQuoteProvider  a real carrier/fulfilment rate for a destination
//   TaxQuoteProvider       jurisdiction-aware tax for the destination
//   PaymentProvider        a payment session (Apple Pay / Google Pay / card),
//                          refunds (6F), and VERIFIED webhooks — the only way an
//                          order is paid or refunded
//   FulfillmentProvider    (6F) warehouse/label/carrier: create and cancel
//                          shipments (outbound and return), tracking, and
//                          VERIFIED, normalized carrier events
//
// NONE IS CHOSEN (docs/COMMERCE_6E.md §7). `providersFor` returns null for each,
// and the checkout says "unavailable" instead of inventing a rate, a tax or a
// payment. Apple In-App Purchase is never a PaymentProvider: the Band is a
// physical good.
//
// Pure — no Convex imports, no network. A real provider is an implementation of
// these interfaces registered in `providersFor`, after the decision is made.

import type { CommerceConfig } from "./config.ts";
import type { ShippingAddress } from "./orders.ts";
import type { CarrierEvent } from "./fulfillment.ts";

export type QuoteDestination = { countryCode: string; region?: string; postalCode?: string; city: string };
export type QuoteLine = { productId: string; sku: string; quantity: number; unitPriceCents: number };

export type ProviderQuote = {
  ok: true;
  amountCents: number;
  currency: string;
  /** The provider's own reference for this quote (no personal data). */
  reference: string;
  /** Shipping: the service level (e.g. "standard"); tax: the jurisdiction. */
  detail: string;
  /** The provider's own expiry, if shorter than Sombrey's. */
  expiresAt?: number;
};
export type ProviderRefusal = { ok: false; reason: "no_service_to_destination" | "provider_error" | "invalid_request" };

export interface ShippingQuoteProvider {
  readonly name: string;
  quote(req: { destination: QuoteDestination; lines: QuoteLine[]; currency: string }): Promise<ProviderQuote | ProviderRefusal>;
}

export interface TaxQuoteProvider {
  readonly name: string;
  /** Tax depends on the destination and what's taxed (goods and, in some
   * jurisdictions, shipping) — so it's quoted after shipping. */
  quote(req: { destination: QuoteDestination; lines: QuoteLine[]; subtotalCents: number; shippingCents: number; currency: string }): Promise<ProviderQuote | ProviderRefusal>;
}

export type PaymentSession = {
  ok: true;
  /** The provider's payment/session id, stored on the order. */
  providerRef: string;
  /** What the app needs to present the provider's sheet (never card data). */
  clientHandoff: Record<string, string>;
};

/** A payment event the provider SIGNED, after the provider verified it. */
export type VerifiedPaymentEvent = {
  eventId: string;
  providerRef: string;
  /** 6I: the idempotency key Sombrey passed to createSession, as echoed in the
   * provider's signed event metadata — binds the event to its attempt. */
  idempotencyKey?: string;
  type: "authorized" | "paid" | "failed" | "cancelled" | "refunded" | "partially_refunded";
  amountCents: number;
  currency: string;
};

export interface PaymentProvider {
  readonly name: string;
  /** Starts (or, for the same idempotency key, returns) a payment session for
   * exactly the order's quoted total. */
  createSession(req: { orderNumber: string; amountCents: number; currency: string; idempotencyKey: string; methods: string[] }): Promise<PaymentSession | ProviderRefusal>;
  /** Verifies a webhook's signature and returns the event — or null for
   * anything unsigned, forged or malformed. Nothing else may mark an order paid. */
  verifyWebhook(rawBody: string, headers: Record<string, string>): Promise<VerifiedPaymentEvent | null>;
  /** 6F: asks the provider to refund part or all of a captured payment. A
   * request only — the order is refunded when the provider's VERIFIED refund
   * event arrives. The same idempotency key never refunds twice. */
  refund(req: { providerRef: string; amountCents: number; currency: string; idempotencyKey: string }): Promise<{ ok: true; refundRef: string } | ProviderRefusal>;
}

/** A carrier event the provider verified (signature) and mapped onto Sombrey's
 * normalized types; `providerRef` identifies the shipment at the provider. */
export type ProviderShipmentEvent = CarrierEvent & { providerRef: string };

export type CreatedShipment = {
  ok: true;
  providerRef: string;
  carrier: string;
  service: string;
  /** Only what the provider actually issued — absent until it does. */
  trackingNumber?: string;
  trackingUrl?: string;
  estimatedDeliveryAt?: number;
  /** The provider's warehouse/location code, if it has one. */
  location?: string;
};

export interface FulfillmentProvider {
  readonly name: string;
  /** Creates (or, for the same idempotency key, returns) one shipment.
   * outbound: warehouse → `address`; return: `address` → the provider's return location. */
  createShipment(req: {
    idempotencyKey: string; orderNumber: string; direction: "outbound" | "return"; address: ShippingAddress;
    items: Array<{ productId: string; sku: string; quantity: number }>;
  }): Promise<CreatedShipment | ProviderRefusal>;
  /** Only before the carrier has the parcel. */
  cancelShipment(providerRef: string): Promise<{ ok: true } | ProviderRefusal>;
  /** The provider's current events for a shipment (polling / recovery after missed webhooks). */
  getTracking(providerRef: string): Promise<ProviderShipmentEvent[] | ProviderRefusal>;
  /** Verifies a webhook's signature, then normalizes its events — null for
   * anything unsigned, forged or malformed. */
  verifyWebhook(rawBody: string, headers: Record<string, string>): Promise<ProviderShipmentEvent[] | null>;
}

export type Providers = {
  shipping: ShippingQuoteProvider | null;
  tax: TaxQuoteProvider | null;
  payment: PaymentProvider | null;
  fulfillment: FulfillmentProvider | null;
};

/** The providers this configuration uses. Today: none of them. */
export function providersFor(config: CommerceConfig): Providers {
  // When a provider is chosen, its config value names it and its
  // implementation is returned here. Until then nothing is invented.
  void config.checkout.provider; void config.checkout.shippingQuoteProvider; void config.checkout.taxQuoteProvider; void config.fulfillment.provider;
  return { shipping: null, tax: null, payment: null, fulfillment: null };
}

// ─── 6I: webhook replay window ───────────────────────────────────────────────
/** Webhook signatures typically cover a timestamp; an adapter's verifyWebhook
 * MUST reject a correctly signed delivery whose timestamp is outside this
 * window (replays of old captured requests), and anything with no timestamp.
 * Event-id de-duplication (commercePaymentEvents / commerceShipmentEvents)
 * catches replays inside the window. 5 minutes is the common provider default. */
export const WEBHOOK_TOLERANCE_MS = 5 * 60 * 1000;

export function webhookTimestampAcceptable(signedAtMs: unknown, nowMs: number, toleranceMs = WEBHOOK_TOLERANCE_MS): boolean {
  return typeof signedAtMs === "number" && Number.isFinite(signedAtMs) && signedAtMs > 0 && Math.abs(nowMs - signedAtMs) <= toleranceMs;
}
