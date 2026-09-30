// Sombrey commerce, Phase 6A — commerce events (convex/commerce/events.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMERCE_EVENTS, validateEvent } from "../../convex/commerce/events.ts";

const P = ["sombrey_band", "sombrey_membership_monthly"];

test("clients record only their own observations", () => {
  for (const name of ["product_viewed", "band_purchase_initiated", "band_checkout_abandoned", "subscription_purchase_initiated", "subscription_checkout_abandoned"]) {
    assert.equal(validateEvent({ name, platform: "ios", productId: "sombrey_band", countryCode: "LK", source: "home_card" }, "client", P), null, name);
  }
  for (const name of Object.keys(COMMERCE_EVENTS).filter((n) => (COMMERCE_EVENTS as Record<string, string>)[n] === "server")) {
    assert.match(validateEvent({ name, platform: "ios" }, "client", P)!, /only be recorded by Sombrey's servers/, `${name}: a client can't claim a purchase`);
  }
});

test("money is a server fact; everything is bounded — no free text or PII", () => {
  assert.match(validateEvent({ name: "product_viewed", platform: "ios", amountCents: 10000, currency: "USD" }, "client", P)!, /amounts/);
  assert.equal(validateEvent({ name: "band_checkout_completed", platform: "backend", amountCents: 10000, currency: "USD" }, "server", P), null);
  assert.match(validateEvent({ name: "band_checkout_completed", platform: "backend", amountCents: 10000 }, "server", P)!, /go together/);
  assert.match(validateEvent({ name: "product_viewed", platform: "ios", source: "https://ads.example/?email=a@b.c" }, "client", P)!, /short label/);
  assert.match(validateEvent({ name: "product_viewed", platform: "ios", countryCode: "United Kingdom" }, "client", P)!, /ISO/);
  assert.match(validateEvent({ name: "product_viewed", platform: "backend" }, "client", P)!, /platform/);
  assert.match(validateEvent({ name: "price_changed", platform: "ios" }, "client", P)!, /Unknown event/);
  assert.match(validateEvent({ name: "product_viewed", platform: "ios", productId: "free_band" }, "client", P)!, /Unknown product/);
});
