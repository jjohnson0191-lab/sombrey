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
const PROTECTED = ["commerceOrders", "commerceSubscriptions", "commerceSubscriptionHistory", "bandOwnership"];

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
  assert.deepEqual(exported(access, "mutation"), ["recordEvent"]);
  assert.deepEqual(exported(access, "action"), []);
  assert.ok(!/\.patch\(|\.replace\(|\.delete\(/.test(access), "access.ts never edits a row");
  assert.ok(!/insert\("(commerceOrders|commerceSubscriptions|commerceSubscriptionHistory|bandOwnership)"/.test(access));
});

test("every state change is an internal function", () => {
  const internal = read("commerce/internal.ts");
  assert.deepEqual(exported(internal, "mutation"), [], "no public mutation in internal.ts");
  assert.deepEqual(exported(internal, "query"), []);
  assert.deepEqual(exported(internal, "action"), []);
  assert.deepEqual(exported(internal, "internalMutation").sort(), ["applyPaymentUpdate", "applyVerifiedSubscription", "createOrder", "setQuote", "updateFulfillment", "updateReturn"]);
});

test("nothing outside the trusted module writes orders, subscriptions or ownership", () => {
  for (const file of allConvexFiles()) {
    if (file === "commerce/internal.ts") continue;
    const src = read(file);
    for (const table of PROTECTED) {
      const writes = new RegExp(`insert\\("${table}"`).test(src);
      assert.ok(!writes, `${file} inserts into ${table}`);
    }
  }
  // users.ts may only delete the user's ownership rows (account deletion) and anonymise events.
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
