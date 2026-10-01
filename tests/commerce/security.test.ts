// Sombrey commerce, Phase 6A — authorization boundaries, checked against the source.
// Clients may only READ their own commerce data and record client-side events;
// every change to orders, subscriptions or Band ownership lives in internal
// functions (convex/commerce/internal.ts) that no client can call.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const CONVEX = join(import.meta.dirname, "../../convex");
const read = (p: string) => readFileSync(join(CONVEX, p), "utf8");
const exported = (src: string, kind: string) => [...src.matchAll(new RegExp(`export const (\\w+) = ${kind}\\(`, "g"))].map((m) => m[1]);
const PROTECTED = ["commerceOrders", "commerceSubscriptions", "commerceSubscriptionHistory", "bandOwnership", "commerceAppStoreNotifications", "commerceAppAccountTokens", "commercePaymentEvents",
  "commerceFulfillments", "commerceShipments", "commerceShipmentEvents", "commerceReturns", "commerceDevices", "commerceActivationAttempts"];
/** The only files allowed to write protected rows: the internal functions and
 * (6C) the shared subscription writer they — and only they — call. */
const TRUSTED_WRITERS = ["commerce/internal.ts", "commerce/subscriptionStore.ts", "commerce/checkoutStore.ts", "commerce/fulfillmentStore.ts", "commerce/returnsStore.ts", "commerce/deviceStore.ts"];

function allConvexFiles(dir = CONVEX, rel = ""): string[] {
  return readdirSync(join(dir), { withFileTypes: true }).flatMap((d) => {
    if (d.name === "_generated" || d.name === "node_modules") return [];
    const r = rel ? `${rel}/${d.name}` : d.name;
    if (d.isDirectory()) return allConvexFiles(join(dir, d.name), r);
    return d.name.endsWith(".ts") ? [r] : [];
  });
}

test("the only client-callable commerce functions are read-only queries and client events", () => {
  const access = read("commerce/access.ts");
  assert.deepEqual(exported(access, "query").sort(), ["myEntitlements", "myOrders", "mySubscription", "publicConfig"]);
  assert.deepEqual(exported(access, "mutation").sort(), ["linkAppStoreAccount", "recordEvent"]);
  assert.deepEqual(exported(access, "action"), []);
  assert.ok(!/\.patch\(|\.replace\(|\.delete\(/.test(access), "access.ts never edits a row");
  assert.ok(!/insert\("(commerceOrders|commerceSubscriptions|commerceSubscriptionHistory|bandOwnership|commerceAppStoreNotifications|commerceAppAccountTokens)"/.test(access));
  // 6C: linking takes NO client input — the token comes from the authenticated identity.
  const link = access.slice(access.indexOf("export const linkAppStoreAccount"), access.indexOf("/** Client-side events only"));
  assert.match(link, /args: \{\}/);
  assert.match(link, /appAccountTokenFor\(identity\.subject\)/);
  assert.ok(!/writeVerifiedSubscription|applyNotification/.test(access), "access.ts can't reach the subscription writer");
});

test("every state change is an internal function", () => {
  const internal = read("commerce/internal.ts");
  assert.deepEqual(exported(internal, "mutation"), [], "no public mutation in internal.ts");
  assert.deepEqual(exported(internal, "query"), []);
  assert.deepEqual(exported(internal, "action"), []);
  assert.deepEqual(exported(internal, "internalMutation").sort(), [
    "applyAppStoreNotification", "applyPaymentUpdate", "applyShipmentEvent", "applyVerifiedSubscription", "createOrder", "grantBandOwnership",
    "reserveAppStoreSubmission", "revokeBandOwnership",
  ]);
});

test("nothing outside the trusted module writes orders, subscriptions or ownership", () => {
  for (const file of allConvexFiles()) {
    if (TRUSTED_WRITERS.includes(file)) continue;
    const src = read(file);
    for (const table of PROTECTED) {
      const writes = new RegExp(`insert\\("${table}"`).test(src);
      assert.ok(!writes, `${file} inserts into ${table}`);
    }
    // 6C: the shared writer is reachable only through internal functions.
    // 6E: the checkout writer is reachable only through the customer API (user from
    // the token) and the internal functions.
    if (/from "[^"]*checkoutStore(\.ts)?"/.test(src)) assert.ok(["commerce/checkout.ts", "commerce/internal.ts"].includes(file), `${file} imports the checkout writer`);
    // 6F: fulfilment/return writers are reachable only through role-checked staff
    // functions, the customer's own-order API, verified internal events, and each other.
    if (/from "[^"]*fulfillmentStore(\.ts)?"/.test(src)) assert.ok(["commerce/staff.ts", "commerce/internal.ts", "commerce/returnsStore.ts"].includes(file), `${file} imports the fulfilment writer`);
    // 6G: the device/ownership writer — staff device ops, the customer's own devices, returns, account deletion.
    if (/from "[^"]*deviceStore(\.ts)?"/.test(src)) assert.ok(["commerce/staffDevices.ts", "commerce/myDevices.ts", "commerce/returnsStore.ts", "users.ts"].includes(file), `${file} imports the device writer`);
    if (/from "[^"]*returnsStore(\.ts)?"/.test(src)) assert.ok(["commerce/staff.ts", "commerce/orderTracking.ts", "commerce/checkoutStore.ts"].includes(file), `${file} imports the returns writer`);
    // Only the read side may import the store module, and only its token link / row mapper.
    if (/from "[^"]*subscriptionStore(\.ts)?"/.test(src)) {
      assert.ok(["commerce/access.ts", "commerce/gate.ts"].includes(file), `${file} imports the subscription writer`);
      assert.ok(!/writeVerifiedSubscription|applyNotification/.test(src), `${file} reaches the subscription writer`);
    }
  }
  const store = read("commerce/subscriptionStore.ts");
  assert.deepEqual([...store.matchAll(/export const (\w+) = (query|mutation|action|internal\w+)\(/g)], [], "the writer module registers no Convex functions");
  // users.ts may only delete the user's ownership rows and token link (account deletion) and anonymise events.
  const users = read("users.ts");
  assert.ok(/bandOwnership"\)\.withIndex\("by_user"/.test(users));
  assert.ok(!/commerceOrders|commerceSubscriptions/.test(users.replace(/\/\/.*$/gm, "")), "financial records are retained on account deletion, never deleted there");
});

test("client-facing reads never return provider internals or transaction ids", () => {
  const access = read("commerce/access.ts");
  const mySub = access.slice(access.indexOf("export const mySubscription"), access.indexOf("export const recordEvent"));
  assert.ok(!/originalTransactionId|latestTransactionId|signedDate/.test(mySub));
  const myOrders = access.slice(access.indexOf("export const myOrders"), access.indexOf("export const mySubscription"));
  assert.ok(!/provider|paymentId|checkoutSessionId/.test(myOrders));
});

test("no user can set a verified subscription state or an order's money/state through legacy paths either", () => {
  // The legacy writers of users.subscriptionTier are role-gated or internal (baseline check).
  const helpers = read("commerce/helpers.ts");
  assert.deepEqual(exported(helpers, "mutation"), []);
  assert.ok(exported(helpers, "internalMutation").includes("updateSubscriptionTier"));
});

// ─── Phase 6B: the iOS StoreKit layer can't grant or claim anything ─────────

const IOS = join(import.meta.dirname, "../../apps/ios/Sombrey");
function swiftFiles(dir = IOS): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? swiftFiles(join(dir, d.name)) : d.name.endsWith(".swift") ? [join(dir, d.name)] : []);
}

test("6B/6C: the app never calls backend-only commerce functions or claims a server event", () => {
  const all = swiftFiles().map((f) => [f, readFileSync(f, "utf8")] as const);
  for (const [f, src] of all) {
    assert.ok(!/commerce\/internal|applyVerifiedSubscription|applyAppStoreNotification|reserveAppStoreSubmission|processNotification|applyPaymentUpdate|updateFulfillment|createOrder|setQuote/.test(src), `${f} references a backend-only commerce function`);
    for (const serverEvent of ["subscription_activated", "subscription_renewed", "subscription_cancelled", "subscription_expired", "band_checkout_completed", "band_order_completed", "band_returned"]) {
      assert.ok(!src.includes(`"${serverEvent}"`), `${f} names the server-only event ${serverEvent}`);
    }
  }
  const convexCalls = all.flatMap(([, src]) => [...src.matchAll(/"commerce\/[a-zA-Z]+:[a-zA-Z]+"/g)].map((m) => m[0]));
  assert.deepEqual([...new Set(convexCalls)].sort(), [
    '"commerce/access:linkAppStoreAccount"', '"commerce/access:myEntitlements"', '"commerce/access:publicConfig"', '"commerce/access:recordEvent"', '"commerce/appStore:submitTransaction"',
  ], "6C/6D: client events, the argument-free account link, the server's entitlement answer, public prices, and Apple-signed transactions — nothing else");
  assert.match(read("commerce/access.ts"), /export const publicConfig = query\(\{\s*args: \{\},/, "public config is a read with no input");
});

test("6B/6C: an unverified transaction can't produce access; only Apple's signed transaction is sent; access is read from the server", () => {
  const models = readFileSync(join(IOS, "Commerce/MembershipModels.swift"), "utf8");
  const manager = readFileSync(join(IOS, "Commerce/MembershipManager.swift"), "utf8");
  assert.ok(/guard let t = best\.transaction\.verifiedValue else \{ return \.unverified \}/.test(models));
  assert.ok(/case \.success\(\.unverified\): return \.failed\(\.unverified\)/.test(models));
  assert.ok(/case \.unverified\(let t, _\):[\s\S]{0,200}ignored/.test(manager), "unverified updates are ignored (and not finished)");
  // Backend calls stay off until a real product id is configured (never for local StoreKit testing).
  assert.match(models, /static func enabled\(productID: String\?\) -> Bool \{\s*guard let productID else \{ return false \}\s*return productID != MembershipProductConfig\.storeKitTestingProductID/);
  assert.match(manager, /guard CommerceBackend\.available, handoff\.verifiableByServer else \{ return \.notSent \}/);
  // The submission carries ONLY the signed transaction — no product, price, expiry, status or account id.
  const submit = manager.match(/action\("commerce\/appStore:submitTransaction", with: (\[[^\]]*\])\)/)?.[1];
  assert.equal(submit, '["signedTransaction": signedTransaction]');
  // A submission result is never access: membership comes only from the server's entitlement read.
  assert.ok(!/serverMembership = \.member/.test(manager), "the app never sets itself a member");
  assert.match(manager, /serverMembership = new/);
  assert.match(models, /case "rejected": return \.rejected/);
  assert.ok(!/\bprint\(|jwsRepresentation\)"|signedTransaction\)"/.test(manager + models), "no raw payload logging");
});
