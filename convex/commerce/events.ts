// Sombrey commerce — Phase 6A: the commercial event catalogue (pure rules).
//
// Sombrey has no product-analytics event pipeline today (convex/analytics.ts is
// owner-only aggregates over existing tables; auditLogs records admin actions),
// so commerce measurement starts here: an append-only `commerceEvents` table
// with a CLOSED catalogue. A future AI-agent system can analyse it; nothing
// here acts on it (no experiments, no price changes).
//
// Each event says who may record it. "client" events (viewing, starting a
// purchase, abandoning a checkout) are the app's own observations and are
// accepted from signed-in users only, strictly validated. "server" events
// (money moved, a subscription changed, a Band returned) are recorded ONLY by
// trusted backend/provider flows — a client can never claim a purchase.
//
// Minimal data: event name, time, account, and a few bounded fields
// (product, country, platform, source, amount+currency on money events). No
// names, emails, addresses, payment details or free text.
//
// Pure — tested in tests/commerce/events.test.ts.

export const COMMERCE_EVENTS = {
  product_viewed: "client",
  band_purchase_initiated: "client",
  band_checkout_abandoned: "client",
  subscription_purchase_initiated: "client",
  // 6B: the user closed Apple's purchase sheet (StoreKit .userCancelled) — the one
  // subscription abandonment the app can honestly observe.
  subscription_checkout_abandoned: "client",
  // 6D: the user met a locked feature (source = the feature id). Recorded at
  // most once per feature per app session by the app; never PII.
  feature_access_denied: "client",
  band_checkout_completed: "server",
  band_order_completed: "server",
  band_returned: "server",
  subscription_activated: "server",
  subscription_renewed: "server",
  subscription_cancelled: "server",
  subscription_expired: "server",
  // 6E: physical checkout milestones the SERVER observes (country + product
  // only — never an address, a name or payment details; no amount: these
  // aren't revenue). Revenue is band_checkout_completed, from a verified
  // provider event only.
  band_quote_requested: "server",
  band_payment_started: "server",
  // 6F: fulfilment and returns — product + country only (never an address, a
  // tracking number or a name). Product-agnostic names, for future hardware.
  // (6A's band_order_completed / band_returned stay in the catalogue for
  // compatibility; 6F records shipment_delivered / return_received instead.)
  fulfillment_created: "server",
  shipment_created: "server",
  shipment_delivered: "server",
  delivery_exception: "server",
  return_requested: "server",
  return_received: "server",
  refund_completed: "server",
  // 6G: device lifecycle — product (+ a reason code as source) only; never a
  // MAC, serial, device id or code.
  device_activation_completed: "server",
  device_activation_failed: "server",
  device_paired: "server",
  device_replaced: "server",
  device_deactivated: "server",
  device_returned: "server",
} as const satisfies Record<string, "client" | "server">;

export type CommerceEventName = keyof typeof COMMERCE_EVENTS;
/** Client events accepted per user per hour (beyond that they're dropped, not stored). */
export const EVENTS_PER_HOUR = 120;
export const PLATFORMS = ["ios", "web", "backend"] as const;

export type CommerceEventInput = {
  name: string;
  productId?: string;
  countryCode?: string;
  platform: string;
  /** Acquisition/source label when the app knows one (e.g. "home_card"); no URLs or free text. */
  source?: string;
  amountCents?: number;
  currency?: string;
};

export function validateEvent(e: CommerceEventInput, origin: "client" | "server", knownProductIds: string[]): string | null {
  const who = (COMMERCE_EVENTS as Record<string, "client" | "server">)[e.name];
  if (!who) return "Unknown event";
  if (origin === "client" && who !== "client") return "This event can only be recorded by Sombrey's servers";
  if (!(PLATFORMS as readonly string[]).includes(e.platform)) return "Unknown platform";
  if (origin === "client" && e.platform === "backend") return "Unknown platform";
  if (e.productId !== undefined && !knownProductIds.includes(e.productId)) return "Unknown product";
  if (e.countryCode !== undefined && !/^[A-Z]{2}$/.test(e.countryCode)) return "Country must be ISO 3166-1 alpha-2";
  if (e.source !== undefined && !/^[a-z0-9_]{1,40}$/.test(e.source)) return "Source must be a short label";
  // Amounts are facts only the server knows.
  if (origin === "client" && (e.amountCents !== undefined || e.currency !== undefined)) return "Clients don't report amounts";
  if (e.amountCents !== undefined && (!Number.isInteger(e.amountCents) || e.amountCents < 0)) return "Invalid amount";
  if ((e.amountCents === undefined) !== (e.currency === undefined)) return "Amount and currency go together";
  if (e.currency !== undefined && !/^[A-Z]{3}$/.test(e.currency)) return "Invalid currency";
  return null;
}
