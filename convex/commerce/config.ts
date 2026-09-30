// Sombrey commerce — Phase 6A: the ONE place provisional business rules live.
//
// ┌──────────────────────────────────────────────────────────────────────────┐
// │  PROVISIONAL — SUBJECT TO CHANGE. Every value below is a launch          │
// │  assumption, not a business truth. Change it here (a new version), never  │
// │  by hard-coding a price, country or policy anywhere else.                 │
// └──────────────────────────────────────────────────────────────────────────┘
//
// Configuration is code: versioned, validated (validateCommerceConfig, run by
// tests/commerce), reviewed like any other change, and identical on every
// request — deterministic production behaviour. There is deliberately no
// remote/database override: a future experimentation or AI-agent system may
// PROPOSE a new version; a human ships it. Orders snapshot the version and
// prices they were created under, so changing this file never rewrites history.
//
// Money is integer minor units (cents), with an ISO 4217 currency — the
// existing Sombrey convention (storeOrders.unitPriceCents, coachingPriceCents).
// Countries are ISO 3166-1 alpha-2 ("GB", not "UK").
//
// Pure — no Convex imports — tested in tests/commerce/config.test.ts.

export type ProductType = "physical" | "subscription";
export type Capability = "band_experience" | "vitals" | "ai_intelligence" | "advanced_features";
export type CommercialState = "none" | "band_owner" | "subscriber" | "band_owner_subscriber";

export type PhysicalProduct = {
  id: string;
  type: "physical";
  displayName: string;
  description: string;
  priceCents: number;
  currency: string;
  active: boolean;
  /** Can be bought without a subscription. */
  purchasableWithoutSubscription: boolean;
  maxQuantityPerOrder: number;
  /** The Band must never be sold as an App Store in-app purchase (physical goods). */
  channel: "physical_checkout";
};

export type SubscriptionProduct = {
  id: string;
  type: "subscription";
  displayName: string;
  priceCents: number;
  currency: string;
  interval: "month" | "year";
  autoRenewing: true;
  trial: { enabled: boolean; days: number };
  /** The App Store Connect product id — unknown until the product is created (6B). */
  appStoreProductId: string | null;
  active: boolean;
  channel: "app_store";
};

export type CommerceConfig = {
  version: string;
  provisional: true;
  currency: string;
  products: { band: PhysicalProduct; membership: SubscriptionProduct };
  shipping: {
    countries: string[];
    paidBy: "customer";
    /** Not set: no rate has been decided. Never invented. */
    rateTable: null;
  };
  tax: { paidBy: "customer"; /** Not set: no tax rate is invented. */ rates: null };
  returns: {
    windowDays: number;
    /** Only these conditions are eligible (e.g. "unused"). */
    eligibleConditions: string[];
    subscriptionRefunds: "none_offered";
  };
  subscriptionPolicy: {
    startsWhen: "purchase_agreed";
    cancellable: "any_time_by_customer";
  };
  checkout: {
    /** Payment methods the eventual physical checkout must offer. */
    methods: Array<"apple_pay" | "google_pay" | "card">;
    /** Undecided (docs/COMMERCE_6A.md §12). null = no provider integrated. */
    provider: null;
  };
  /** Which capabilities each commercial state grants — refined in Phase 6D. */
  capabilityMatrix: Record<CommercialState, Capability[]>;
  /** Existing access paths honoured as "subscriber-level" until 6D decides (see §8 of the doc). */
  legacyAccessGrantsSubscriberCapabilities: boolean;
  /** Whether a Band paired before commerce existed counts as owning one (decision pending). */
  pairedDeviceCountsAsBandOwnership: boolean;
};

/** PROVISIONAL — SUBJECT TO CHANGE. Launch assumptions, 2026-10. */
export const COMMERCE_CONFIG: CommerceConfig = {
  version: "2026-10-provisional.1",
  provisional: true,
  currency: "USD",
  products: {
    band: {
      id: "sombrey_band",
      type: "physical",
      displayName: "Sombrey Band",
      description: "The Sombrey wearable band.",
      priceCents: 100_00,
      currency: "USD",
      active: true,
      purchasableWithoutSubscription: true,
      maxQuantityPerOrder: 5,
      channel: "physical_checkout",
    },
    membership: {
      id: "sombrey_membership_monthly",
      type: "subscription",
      displayName: "Sombrey Membership",
      priceCents: 30_00,
      currency: "USD",
      interval: "month",
      autoRenewing: true,
      trial: { enabled: false, days: 0 },
      appStoreProductId: null,
      active: true,
      channel: "app_store",
    },
  },
  shipping: { countries: ["US", "GB", "AE", "CA", "AU", "LK"], paidBy: "customer", rateTable: null },
  tax: { paidBy: "customer", rates: null },
  returns: { windowDays: 30, eligibleConditions: ["unused"], subscriptionRefunds: "none_offered" },
  subscriptionPolicy: { startsWhen: "purchase_agreed", cancellable: "any_time_by_customer" },
  checkout: { methods: ["apple_pay", "google_pay", "card"], provider: null },
  capabilityMatrix: {
    none: [],
    band_owner: ["band_experience", "vitals"],
    subscriber: ["ai_intelligence", "advanced_features"],
    band_owner_subscriber: ["band_experience", "vitals", "ai_intelligence", "advanced_features"],
  },
  legacyAccessGrantsSubscriberCapabilities: true,
  pairedDeviceCountsAsBandOwnership: true,
};

export const CAPABILITIES: readonly Capability[] = ["band_experience", "vitals", "ai_intelligence", "advanced_features"];
const ISO_COUNTRY = /^[A-Z]{2}$/;
const ISO_CURRENCY = /^[A-Z]{3}$/;
const PRODUCT_ID = /^[a-z][a-z0-9_]{2,47}$/;
/** Two-letter codes that look right but aren't ISO 3166-1 country codes. */
const NOT_ISO: Record<string, string> = { UK: "use GB", EU: "not a country" };

/** Every problem with a config (empty = valid). Tests fail on any problem, so
 * an invalid config can't ship. */
export function validateCommerceConfig(c: CommerceConfig): string[] {
  const p: string[] = [];
  if (!/^\d{4}-\d{2}-[a-z0-9.-]+$/.test(c.version)) p.push("version: expected YYYY-MM-<label>");
  if (!ISO_CURRENCY.test(c.currency)) p.push("currency: ISO 4217");
  const products = [c.products.band, c.products.membership];
  const ids = new Set<string>();
  for (const x of products) {
    if (!PRODUCT_ID.test(x.id)) p.push(`${x.id}: invalid product id`);
    if (ids.has(x.id)) p.push(`${x.id}: duplicate product id`);
    ids.add(x.id);
    if (!Number.isInteger(x.priceCents) || x.priceCents <= 0 || x.priceCents > 1_000_000_00) p.push(`${x.id}: price must be a positive integer number of cents`);
    if (!ISO_CURRENCY.test(x.currency)) p.push(`${x.id}: currency`);
    if (x.currency !== c.currency) p.push(`${x.id}: currency differs from the store currency`);
    if (!x.displayName.trim()) p.push(`${x.id}: display name`);
  }
  if (c.products.band.channel !== "physical_checkout") p.push("band: a physical product can't be an App Store purchase");
  if (!Number.isInteger(c.products.band.maxQuantityPerOrder) || c.products.band.maxQuantityPerOrder < 1 || c.products.band.maxQuantityPerOrder > 20) p.push("band: maxQuantityPerOrder 1–20");
  const m = c.products.membership;
  if (m.channel !== "app_store") p.push("membership: subscriptions are sold through the App Store");
  if (m.trial.enabled ? !(Number.isInteger(m.trial.days) && m.trial.days >= 1 && m.trial.days <= 31) : m.trial.days !== 0) p.push("membership: trial days inconsistent with trial.enabled");
  if (m.appStoreProductId !== null && !/^[A-Za-z0-9._-]{3,100}$/.test(m.appStoreProductId)) p.push("membership: appStoreProductId format");
  const countries = c.shipping.countries;
  if (!countries.length) p.push("shipping: at least one country");
  if (new Set(countries).size !== countries.length) p.push("shipping: duplicate country");
  for (const k of countries) {
    if (!ISO_COUNTRY.test(k)) p.push(`shipping: ${k} is not ISO 3166-1 alpha-2`);
    else if (NOT_ISO[k]) p.push(`shipping: ${k} is not ISO 3166-1 alpha-2 (${NOT_ISO[k]})`);
  }
  if (c.shipping.rateTable !== null) p.push("shipping: rates must not be set until decided");
  if (c.tax.rates !== null) p.push("tax: rates must not be set until decided");
  if (!Number.isInteger(c.returns.windowDays) || c.returns.windowDays < 0 || c.returns.windowDays > 365) p.push("returns: windowDays 0–365");
  if (!c.returns.eligibleConditions.length) p.push("returns: at least one eligible condition");
  if (!c.checkout.methods.length) p.push("checkout: at least one payment method");
  for (const [state, caps] of Object.entries(c.capabilityMatrix)) {
    for (const cap of caps) if (!CAPABILITIES.includes(cap)) p.push(`capabilityMatrix.${state}: unknown ${cap}`);
  }
  if (c.capabilityMatrix.none.length) p.push("capabilityMatrix.none: no commercial relationship grants nothing paid");
  const both = new Set(c.capabilityMatrix.band_owner_subscriber);
  for (const cap of [...c.capabilityMatrix.band_owner, ...c.capabilityMatrix.subscriber]) {
    if (!both.has(cap)) p.push(`capabilityMatrix.band_owner_subscriber: must include ${cap}`);
  }
  return p;
}

/** Whether a country is a configured shipping destination. */
export function isSupportedCountry(c: CommerceConfig, code: string): boolean {
  return c.shipping.countries.includes(code);
}

/** What any client may see: prices, countries and policies — no internals. */
export function publicCommerceConfig(c: CommerceConfig) {
  return {
    version: c.version,
    provisional: c.provisional,
    currency: c.currency,
    band: { id: c.products.band.id, displayName: c.products.band.displayName, priceCents: c.products.band.priceCents, currency: c.products.band.currency, active: c.products.band.active },
    membership: {
      id: c.products.membership.id, displayName: c.products.membership.displayName, priceCents: c.products.membership.priceCents,
      currency: c.products.membership.currency, interval: c.products.membership.interval, trialDays: c.products.membership.trial.enabled ? c.products.membership.trial.days : 0,
    },
    shippingCountries: [...c.shipping.countries],
    shippingPaidBy: c.shipping.paidBy,
    taxPaidBy: c.tax.paidBy,
    returnWindowDays: c.returns.windowDays,
    returnEligibleConditions: [...c.returns.eligibleConditions],
    subscriptionRefunds: c.returns.subscriptionRefunds,
  };
}
