// Sombrey commerce, Phase 6I — the integrity report, for owner/admin only.
// Read-only: it lists inconsistencies by id; it changes nothing. Repairs go
// through the existing audited staff mutations, one record at a time.

import { query } from "../_generated/server";
import { auditCommerceIntegrity } from "./integrity";
import { requireStaff } from "./staff";

/** Bounded reads: a report over the most recent records, flagged when truncated. */
const LIMIT = 2000;

export const integrityReport = query({
  args: {},
  handler: async (ctx) => {
    await requireStaff(ctx, "money");
    const [orders, fulfillments, shipments, returns, devices, ownerships] = await Promise.all([
      ctx.db.query("commerceOrders").order("desc").take(LIMIT),
      ctx.db.query("commerceFulfillments").order("desc").take(LIMIT),
      ctx.db.query("commerceShipments").order("desc").take(LIMIT),
      ctx.db.query("commerceReturns").order("desc").take(LIMIT),
      ctx.db.query("commerceDevices").order("desc").take(LIMIT),
      ctx.db.query("bandOwnership").order("desc").take(LIMIT),
    ]);
    const truncated = [orders, fulfillments, shipments, returns, devices, ownerships].some((t) => t.length === LIMIT);
    const issues = auditCommerceIntegrity({
      orders: orders.map((o) => ({ ...o, paymentAttempt: o.paymentAttempt ?? null })),
      fulfillments, shipments, returns, devices, ownerships,
    });
    // Over a truncated window a parent may simply be older than the window, so
    // "without parent" findings are only reported over complete data.
    const reported = truncated ? issues.filter((i) => !/_without_(order|parent)$/.test(i.kind)) : issues;
    return { checkedAt: Date.now(), truncated, issues: reported };
  },
});
