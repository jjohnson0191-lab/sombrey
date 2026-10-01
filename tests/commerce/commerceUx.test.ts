// Sombrey commerce, Phase 6H — the in-app commerce UX stays a presentation layer.
// Backend rules the screens rely on, and source checks on the Swift surfaces.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COMMERCE_CONFIG, knownProductIds, publicCommerceConfig } from "../../convex/commerce/config.ts";
import { visibleToCustomer } from "../../convex/commerce/fulfillment.ts";
import { validateEvent } from "../../convex/commerce/events.ts";

const IOS = join(import.meta.dirname, "../../apps/ios/Sombrey");
const swift = (f: string) => readFileSync(join(IOS, f), "utf8");
const code = (s: string) => s.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

test("an order is shown only to its owner (orders list, detail, tracking)", () => {
  const order = { userId: "users:alice", orderNumber: "SB-1" };
  assert.equal(visibleToCustomer(order, "users:alice"), order);
  assert.equal(visibleToCustomer(order, "users:bob"), null);
  assert.equal(visibleToCustomer(null, "users:alice"), null);
  const tracking = readFileSync(join(import.meta.dirname, "../../convex/commerce/orderTracking.ts"), "utf8");
  assert.match(tracking, /visibleToCustomer\(await ctx\.db\.get\(args\.orderId\), user\._id\)/);
  const access = readFileSync(join(import.meta.dirname, "../../convex/commerce/access.ts"), "utf8");
  assert.match(access.slice(access.indexOf("export const myOrders")), /withIndex\("by_user", \(q\) => q\.eq\("userId", user\._id\)\)/);
});

test("the public config gives the app a price, a name and a checkout flag — the app adds nothing", () => {
  const band = publicCommerceConfig(COMMERCE_CONFIG).band;
  assert.deepEqual([band.displayName, band.generation, band.priceCents, band.currency, band.checkoutAvailable], ["Sombrey Band", "V1", 10000, "USD", false]);
});

test("6H client events: what was viewed or started — no codes, addresses or ids; revenue stays server-only", () => {
  const known = knownProductIds(COMMERCE_CONFIG);
  for (const name of ["restore_purchases_started", "order_viewed", "tracking_viewed", "device_activation_started", "product_viewed"]) {
    assert.equal(validateEvent({ name, platform: "ios" }, "client", known), null, name);
  }
  assert.match(validateEvent({ name: "device_activation_started", platform: "ios", source: "ABCD-EFGH-JKMN" }, "client", known)!, /short label/, "an activation code can't ride along");
  assert.match(validateEvent({ name: "order_viewed", platform: "ios", source: "1 Test Street" }, "client", known)!, /short label/);
  for (const name of ["band_checkout_completed", "refund_completed", "device_activation_completed", "subscription_activated"]) {
    assert.match(validateEvent({ name, platform: "ios" }, "client", known)!, /only be recorded by Sombrey's servers/, name);
  }
});

test("Swift: no client-side unlock — no local premium/Band flags, nothing persisted, success only from the server", () => {
  for (const f of ["Commerce/CommerceViews.swift", "Commerce/CommerceModels.swift", "Commerce/AccessViews.swift", "Commerce/EntitlementStore.swift", "Settings/SettingsScreen.swift"]) {
    const src = code(swift(f));
    assert.ok(!/isPremium|hasBand\s*=|isMember\s*=\s*true|ownsBand\s*=\s*true|UserDefaults|@AppStorage\("[^"]*(member|premium|band|entitle)/i.test(src), `${f} keeps a local unlock flag`);
  }
  const views = code(swift("Commerce/CommerceViews.swift"));
  assert.match(views, /BandOwnership\.from\(ownsBand: e\.ownsBand, devices: devices\.value\)/, "Band ownership comes from the server's entitlements");
  assert.match(views, /outcome = ActivationCopy\.outcome\(reply\.status\)/, "activation success only from the server's answer");
  assert.ok(!/outcome = \(true/.test(views), "the UI never declares activation success itself");
});

test("Swift: the Band is never an in-app purchase, prices are never hard-coded, and checkout follows the server", () => {
  const views = code(swift("Commerce/CommerceViews.swift"));
  const band = views.slice(views.indexOf("struct BandView"), views.indexOf("struct ActivationView"));
  assert.ok(!/Product\.products|\.purchase\(|StoreKit|membership\.purchase/.test(band), "no StoreKit in the Band screen");
  // (Swift's `$0` closure shorthand isn't a price: look for real currency literals.)
  assert.ok(!/\$\d+\.\d\d|"[^"\n]*\$\s?\d{2,}|\b10000\b|\b100\.00\b|\b30\.00\b|priceCents: \d/.test(views + code(swift("Commerce/CommerceModels.swift"))), "no price literals in the UI");
  assert.match(band, /PriceText\.format\(cents: config\.value\?\.band\.priceCents, currency: config\.value\?\.band\.currency\)/);
  assert.match(band, /BandCheckout\.state\(checkoutAvailable: config\.value\?\.band\.checkoutAvailable/);
  assert.ok(!/TextField\("(Card|Address|Postcode|Postal)/i.test(views), "no payment or address form");
});

test("Swift: tracking only when real; commerce screens never touch Bluetooth", () => {
  const views = code(swift("Commerce/CommerceViews.swift"));
  assert.match(views, /t\.shipments\.compactMap\(TrackingCopy\.line\)/);
  assert.match(views, /Text\(TrackingCopy\.unavailable\)/);
  assert.ok(!/withAnimation|\.repeatForever|Timer\./.test(views), "no animated fake journey");
  for (const f of ["Commerce/CommerceViews.swift", "Commerce/CommerceModels.swift"]) {
    assert.ok(!/QCSDK|QCBand|CoreBluetooth|CBPeripheral|WearableManager|getDeviceMacAddress/.test(code(swift(f))), `${f} touches Bluetooth`);
  }
});

test("placement: Membership, Sombrey Band and Orders live in Settings › Account, only when the backend serves entitlements", () => {
  const settings = code(swift("Settings/SettingsScreen.swift"));
  const block = settings.slice(settings.indexOf("if entitlements.enforced {"), settings.indexOf("} else {", settings.indexOf("if entitlements.enforced {")));
  for (const row of ['row("Membership"', 'row("Sombrey Band"', 'row("Orders")']) assert.ok(block.includes(row), row);
  const tabs = code(swift("App/AuthenticatedRootView.swift"));
  assert.ok(!/case \.(orders|membership|shop|store)/.test(tabs), "no new tab");
});
