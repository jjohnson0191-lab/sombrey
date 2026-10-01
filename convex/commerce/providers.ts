// Sombrey commerce — Phase 6E: the provider boundary for physical checkout.
//
// Sombrey's order domain talks to three kinds of outside service through these
// interfaces only, so it never becomes coupled to one vendor:
//
//   ShippingQuoteProvider  a real carrier/fulfilment rate for a destination
//   TaxQuoteProvider       jurisdiction-aware tax for the destination
//   PaymentProvider        a payment session (Apple Pay / Google Pay / card)
//                          and VERIFIED webhooks — the only way an order is paid
//
// NONE IS CHOSEN (docs/COMMERCE_6E.md §7). `providersFor` returns null for each,
// and the checkout says "unavailable" instead of inventing a rate, a tax or a
// payment. Apple In-App Purchase is never a PaymentProvider: the Band is a
// physical good.
//
// Pure — no Convex imports, no network. A real provider is an implementation of
// these interfaces registered in `providersFor`, after the decision is made.

import type { CommerceConfig } from "./config.ts";

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
}

export type Providers = {
  shipping: ShippingQuoteProvider | null;
  tax: TaxQuoteProvider | null;
  payment: PaymentProvider | null;
};

/** The providers this configuration uses. Today: none of them. */
export function providersFor(config: CommerceConfig): Providers {
  // When a provider is chosen, its config value names it and its
  // implementation is returned here. Until then nothing is invented.
  void config.checkout.provider; void config.checkout.shippingQuoteProvider; void config.checkout.taxQuoteProvider;
  return { shipping: null, tax: null, payment: null };
}
