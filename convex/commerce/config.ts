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

/** Phase 6D: every access-controlled surface of the app, by stable id. The app
 * asks the server "may I show feature X?" — it never decides this itself. */
export type FeatureId =
  | "account" | "settings" | "band_pairing" | "core_tracking" | "body_scan"
  | "vitals" | "wearable_data" | "ai_coach" | "ai_meal_analysis" | "advanced_intelligence";

export type FeatureRule = {
  /** Capabilities ALL required (empty = any signed-in user). */
  requires: Capability[];
  /** What the surface is — documentation for people, not logic. */
  covers: string;
};

export type PhysicalProduct = {
  /** Stable internal product id — used by orders and events; never changes. */
  id: string;
  type: "physical";
  /** Phase 6E: what this physical product is, and its stock-keeping unit. */
  category: "physical_band";
  sku: string;
  /** The hardware generation sold under this SKU (customer-facing name: "Sombrey Band V1"). */
  hardwareGeneration: string;
  /** Phase 6F: how it ships and whether it may be returned — per product, so
   * future hardware can differ. `requiresActivation` is for 6G (informational
   * here: fulfilment never activates or assigns ownership). */
  fulfillmentProfile: "parcel";
  returnable: boolean;
  requiresActivation: boolean;
  /** Phase 6G: the hardware identifiers this product actually exposes (evidence:
   * docs/COMMERCE_6G.md §4). The Band V1: its MAC only — no serial number API. */
  identityKinds: Array<"mac" | "serial" | "vendor_id">;
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
    /** Phase 6F: the return window counts from the carrier-confirmed delivery. */
    clockStartsAt: "delivery";
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
    /** Payment provider — undecided (docs/COMMERCE_6E.md §7). null = none
     * integrated: no payment can start, nothing is ever marked paid. */
    provider: null;
    /** Phase 6E: shipping and tax quote providers — undecided. null = no
     * quote: shipping, tax and the total stay unknown (never invented). */
    shippingQuoteProvider: null;
    taxQuoteProvider: null;
    /** How long a shipping+tax quote may be paid against. */
    quoteTtlMinutes: number;
    /** Open (unpaid, uncancelled) checkouts one account may hold at once. */
    maxOpenCheckoutsPerUser: number;
  };
  /** Phase 6F: the fulfilment/logistics provider (warehouse, labels, tracking)
   * — undecided. null = nothing can be submitted, shipped or tracked; no
   * tracking number, status or date is ever invented. */
  fulfillment: {
    provider: null;
    /** Staff view: a shipment with no carrier update for this long is flagged. */
    stalledTrackingAfterHours: number;
  };
  /** Phase 6G: physical devices, activation and ownership. */
  devices: {
    /** Activation needs the device's fulfilment to be carrier-delivered (no
     * provider yet → no delivery → customers can't self-activate; staff can
     * hand over in person). */
    activationRequiresDelivery: boolean;
    /** When a returned device stops being owned: when staff receive it, or when
     * the refund is verified. Return REQUESTED never ends ownership. */
    ownershipEndsOnReturnAt: "received" | "refunded";
    /** Failed activation attempts per account per hour (code guessing). */
    activationAttemptsPerHour: number;
  };
  /** Phase 6E: no inventory source exists. null = stock is NOT tracked — the
   * app must never show stock levels ("In stock", "Only 3 left"). */
  inventory: { provider: null };
  /** Which capabilities each commercial state grants. */
  capabilityMatrix: Record<CommercialState, Capability[]>;
  /** Phase 6D: which capabilities each app feature needs (docs/COMMERCE_6D.md §3). */
  featureMatrix: Record<FeatureId, FeatureRule>;
  /** Existing access paths honoured as "subscriber-level" until 6D decides (see §8 of the doc). */
  legacyAccessGrantsSubscriberCapabilities: boolean;
  /** Whether a Bluetooth pairing ALONE counts as owning a Band. Phase 6D: no —
   * any client can register a device, so pairing is never proof. Bands paired
   * before commerce existed are recognised through an audited ownership record
   * (source "legacy_pairing"/"staff_grant", internal.grantBandOwnership). */
  pairedDeviceCountsAsBandOwnership: boolean;
};

/** PROVISIONAL — SUBJECT TO CHANGE. Launch assumptions, 2026-10. */
export const COMMERCE_CONFIG: CommerceConfig = {
  version: "2026-10-provisional.5",
  provisional: true,
  currency: "USD",
  products: {
    band: {
      id: "sombrey_band",
      type: "physical",
      category: "physical_band",
      sku: "SOMBREY_BAND_V1",
      hardwareGeneration: "V1",
      fulfillmentProfile: "parcel",
      returnable: true,
      requiresActivation: true,
      identityKinds: ["mac"],
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
  returns: { clockStartsAt: "delivery", windowDays: 30, eligibleConditions: ["unused"], subscriptionRefunds: "none_offered" },
  subscriptionPolicy: { startsWhen: "purchase_agreed", cancellable: "any_time_by_customer" },
  checkout: {
    methods: ["apple_pay", "google_pay", "card"],
    provider: null,
    shippingQuoteProvider: null,
    taxQuoteProvider: null,
    quoteTtlMinutes: 15,
    maxOpenCheckoutsPerUser: 3,
  },
  fulfillment: { provider: null, stalledTrackingAfterHours: 72 },
  devices: { activationRequiresDelivery: true, ownershipEndsOnReturnAt: "received", activationAttemptsPerHour: 10 },
  inventory: { provider: null },
  capabilityMatrix: {
    none: [],
    band_owner: ["band_experience", "vitals"],
    subscriber: ["ai_intelligence", "advanced_features"],
    band_owner_subscriber: ["band_experience", "vitals", "ai_intelligence", "advanced_features"],
  },
  // PROVISIONAL (6D). Existing Band-free features stay free; Band-derived
  // physiology needs a Band; AI needs membership. Nothing is invented here:
  // each entry is a surface that exists in the app today.
  featureMatrix: {
    account: { requires: [], covers: "Sign-in, profile, account deletion" },
    settings: { requires: [], covers: "Settings, notifications, schedules, privacy" },
    band_pairing: { requires: [], covers: "Pairing a Band over Bluetooth — never proof of ownership" },
    core_tracking: { requires: [], covers: "Training logs, workouts, exercise library, nutrition logging and food search, progress, goals" },
    body_scan: { requires: [], covers: "Body Scan — unchanged; its own consent, ownership and privacy rules apply" },
    vitals: { requires: ["vitals"], covers: "The Vitals screen and live Band measurements" },
    wearable_data: { requires: ["band_experience"], covers: "Band-derived Readiness, Strain, sleep and recorded wearable history" },
    ai_coach: { requires: ["ai_intelligence"], covers: "Sombrey Coach (AI conversation)" },
    ai_meal_analysis: { requires: ["ai_intelligence"], covers: "AI Macro Calculator (photo analysis)" },
    advanced_intelligence: { requires: ["advanced_features"], covers: "Reserved — no surface exists yet; nothing is gated by it today" },
  },
  legacyAccessGrantsSubscriberCapabilities: true,
  pairedDeviceCountsAsBandOwnership: false,
};

export const FEATURE_IDS = Object.keys(COMMERCE_CONFIG.featureMatrix) as FeatureId[];

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
  if (!Number.isInteger(c.fulfillment.stalledTrackingAfterHours) || c.fulfillment.stalledTrackingAfterHours < 12 || c.fulfillment.stalledTrackingAfterHours > 720) p.push("fulfillment: stalledTrackingAfterHours 12–720");
  if (c.returns.clockStartsAt !== "delivery") p.push("returns: the window counts from delivery");
  if (!Number.isInteger(c.devices.activationAttemptsPerHour) || c.devices.activationAttemptsPerHour < 3 || c.devices.activationAttemptsPerHour > 50) p.push("devices: activationAttemptsPerHour 3–50");
  if (c.products.band.requiresActivation && !c.products.band.identityKinds.length) p.push("band: a product that needs activation needs at least one hardware identifier");
  if (!Number.isInteger(c.checkout.quoteTtlMinutes) || c.checkout.quoteTtlMinutes < 1 || c.checkout.quoteTtlMinutes > 60) p.push("checkout: quoteTtlMinutes 1–60");
  if (!Number.isInteger(c.checkout.maxOpenCheckoutsPerUser) || c.checkout.maxOpenCheckoutsPerUser < 1 || c.checkout.maxOpenCheckoutsPerUser > 10) p.push("checkout: maxOpenCheckoutsPerUser 1–10");
  if (!/^[A-Z0-9_]{3,40}$/.test(c.products.band.sku)) p.push("band: sku must be UPPER_SNAKE");
  if (c.products.band.category !== "physical_band") p.push("band: category");
  // Overflow guard: the largest possible subtotal must stay an exact integer.
  if (!Number.isSafeInteger(c.products.band.priceCents * c.products.band.maxQuantityPerOrder)) p.push("band: price × max quantity overflows");
  for (const [state, caps] of Object.entries(c.capabilityMatrix)) {
    for (const cap of caps) if (!CAPABILITIES.includes(cap)) p.push(`capabilityMatrix.${state}: unknown ${cap}`);
  }
  if (c.capabilityMatrix.none.length) p.push("capabilityMatrix.none: no commercial relationship grants nothing paid");
  for (const [feature, rule] of Object.entries(c.featureMatrix)) {
    for (const cap of rule.requires) if (!CAPABILITIES.includes(cap)) p.push(`featureMatrix.${feature}: unknown ${cap}`);
    // Every paid feature must be reachable by SOME state, or it could never be unlocked.
    if (rule.requires.length && !rule.requires.every((cap) => c.capabilityMatrix.band_owner_subscriber.includes(cap))) {
      p.push(`featureMatrix.${feature}: no commercial state unlocks it`);
    }
  }
  for (const f of ["account", "settings", "band_pairing"] as const) {
    if (c.featureMatrix[f]?.requires.length) p.push(`featureMatrix.${f}: must stay available to every signed-in user`);
  }
  const both = new Set(c.capabilityMatrix.band_owner_subscriber);
  for (const cap of [...c.capabilityMatrix.band_owner, ...c.capabilityMatrix.subscriber]) {
    if (!both.has(cap)) p.push(`capabilityMatrix.band_owner_subscriber: must include ${cap}`);
  }
  return p;
}

/** Phase 6F: the physical product with this id (one today: the Band). Every
 * fulfilment/return rule looks products up here, so future hardware is a
 * config entry, not a code change. */
export function physicalProduct(c: CommerceConfig, productId: string): PhysicalProduct | undefined {
  return [c.products.band].find((p) => p.id === productId);
}

/** Every product id the commerce events may name. */
export function knownProductIds(c: CommerceConfig): string[] {
  return [c.products.band.id, c.products.membership.id];
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
    band: {
      id: c.products.band.id, sku: c.products.band.sku, displayName: c.products.band.displayName, priceCents: c.products.band.priceCents,
      currency: c.products.band.currency, active: c.products.band.active,
      // 6E: whether a Band can actually be bought now (a payment provider exists).
      checkoutAvailable: c.products.band.active && c.checkout.provider !== null,
    },
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
