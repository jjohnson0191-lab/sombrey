// Sombrey commerce, Phase 6A — the provisional configuration (convex/commerce/config.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMERCE_CONFIG, isSupportedCountry, publicCommerceConfig, validateCommerceConfig, type CommerceConfig } from "../../convex/commerce/config.ts";

const clone = (): CommerceConfig => structuredClone(COMMERCE_CONFIG);

test("the shipped configuration is valid", () => {
  assert.deepEqual(validateCommerceConfig(COMMERCE_CONFIG), []);
  assert.equal(COMMERCE_CONFIG.provisional, true);
});

test("the provisional launch model (PROVISIONAL — SUBJECT TO CHANGE)", () => {
  const c = COMMERCE_CONFIG;
  assert.equal(c.products.band.priceCents, 10000);
  assert.equal(c.products.band.currency, "USD");
  assert.equal(c.products.band.purchasableWithoutSubscription, true);
  assert.equal(c.products.band.channel, "physical_checkout", "never an App Store in-app purchase");
  assert.equal(c.products.membership.priceCents, 3000);
  assert.equal(c.products.membership.interval, "month");
  assert.deepEqual(c.products.membership.trial, { enabled: false, days: 0 });
  assert.equal(c.products.membership.appStoreProductId, null, "not created yet — never invented");
  assert.deepEqual(c.shipping.countries, ["US", "GB", "AE", "CA", "AU", "LK"]);
  assert.equal(c.shipping.rateTable, null);
  assert.equal(c.tax.rates, null);
  assert.deepEqual([c.returns.windowDays, c.returns.eligibleConditions, c.returns.subscriptionRefunds], [30, ["unused"], "none_offered"]);
  assert.deepEqual(c.checkout, { methods: ["apple_pay", "google_pay", "card"], provider: null });
});

test("invalid configurations are caught before they can ship", () => {
  const cases: Array<[(c: CommerceConfig) => void, RegExp]> = [
    [(c) => { c.products.band.priceCents = 99.5; }, /positive integer/],
    [(c) => { c.products.band.priceCents = -100; }, /positive integer/],
    [(c) => { c.shipping.countries.push("UK"); }, /UK is not ISO/],
    [(c) => { c.shipping.countries.push("US"); }, /duplicate country/],
    [(c) => { c.shipping.countries = []; }, /at least one country/],
    [(c) => { (c.tax as { rates: unknown }).rates = { US: 0.08 }; }, /tax: rates/],
    [(c) => { (c.shipping as { rateTable: unknown }).rateTable = { US: 999 }; }, /shipping: rates/],
    [(c) => { (c.products.band as { channel: string }).channel = "app_store"; }, /physical product/],
    [(c) => { c.products.membership.trial = { enabled: false, days: 7 }; }, /trial days/],
    [(c) => { c.products.membership.currency = "GBP"; }, /currency differs/],
    [(c) => { c.capabilityMatrix.none = ["vitals"]; }, /grants nothing paid/],
    [(c) => { c.capabilityMatrix.band_owner_subscriber = ["vitals"]; }, /must include/],
    [(c) => { c.returns.windowDays = 400; }, /windowDays/],
  ];
  for (const [mutate, why] of cases) {
    const c = clone();
    mutate(c);
    const problems = validateCommerceConfig(c);
    assert.ok(problems.some((p) => why.test(p)), `${why} → ${JSON.stringify(problems)}`);
  }
});

test("countries: only the configured ones, ISO alpha-2, configurable", () => {
  for (const k of ["US", "GB", "AE", "CA", "AU", "LK"]) assert.ok(isSupportedCountry(COMMERCE_CONFIG, k));
  for (const k of ["UK", "FR", "us", "", "USA"]) assert.ok(!isSupportedCountry(COMMERCE_CONFIG, k), k);
  const c = clone(); c.shipping.countries.push("NZ");
  assert.deepEqual(validateCommerceConfig(c), []);
  assert.ok(isSupportedCountry(c, "NZ"), "expansion is a config change");
});

test("the public config exposes prices and policies — not internals", () => {
  const p = publicCommerceConfig(COMMERCE_CONFIG);
  assert.equal(p.band.priceCents, 10000);
  assert.equal(p.membership.trialDays, 0);
  const json = JSON.stringify(p);
  for (const k of ["capabilityMatrix", "legacyAccess", "pairedDevice", "provider", "appStoreProductId", "maxQuantity"]) assert.ok(!json.includes(k), k);
});
