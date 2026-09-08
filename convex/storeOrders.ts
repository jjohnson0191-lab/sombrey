import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { hasRole } from "./lib/roles.js";

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function requireFulfillment(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });

  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();

  if (!user || !hasRole(user, "owner", "admin")) {
    throw new ConvexError({ code: "FORBIDDEN", message: "Owner or Admin access required" });
  }
  return user;
}

// ─── List orders ─────────────────────────────────────────────────────────────

export const list = query({
  args: {
    status: v.optional(v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("shipped"),
      v.literal("delivered"),
      v.literal("cancelled"),
      v.literal("all"),
    )),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<import("./_generated/dataModel.js").Doc<"storeOrders">[]> => {
    await requireFulfillment(ctx);
    const limit = args.limit ?? 100;
    const status = args.status ?? "all";

    if (status === "all") {
      return ctx.db.query("storeOrders").order("desc").take(limit);
    }
    return ctx.db
      .query("storeOrders")
      .withIndex("by_status", (q) => q.eq("status", status))
      .order("desc")
      .take(limit);
  },
});

// ─── Get single order ─────────────────────────────────────────────────────────

export const getById = query({
  args: { orderId: v.id("storeOrders") },
  handler: async (ctx, args) => {
    await requireFulfillment(ctx);
    return ctx.db.get(args.orderId);
  },
});

// ─── Create order ─────────────────────────────────────────────────────────────

export const create = mutation({
  args: {
    customerId: v.optional(v.id("users")),
    customerName: v.string(),
    customerEmail: v.string(),
    customerPhone: v.optional(v.string()),
    shippingFullName: v.string(),
    shippingAddress: v.string(),
    shippingCity: v.string(),
    shippingCountry: v.string(),
    shippingPostalCode: v.string(),
    items: v.array(v.object({
      productId: v.optional(v.id("storeProducts")),
      productName: v.string(),
      variantName: v.optional(v.string()),
      quantity: v.number(),
      unitPriceCents: v.number(),
    })),
    totalCents: v.number(),
    currency: v.string(),
    commerceOrderId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireFulfillment(ctx);
    return ctx.db.insert("storeOrders", {
      ...args,
      status: "pending",
      orderDate: new Date().toISOString(),
    });
  },
});

// ─── Update order status ──────────────────────────────────────────────────────

export const updateStatus = mutation({
  args: {
    orderId: v.id("storeOrders"),
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("shipped"),
      v.literal("delivered"),
      v.literal("cancelled"),
    ),
    trackingNumber: v.optional(v.string()),
    fulfillmentNotes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireFulfillment(ctx);
    const { orderId, ...updates } = args;
    const order = await ctx.db.get(orderId);
    if (!order) throw new ConvexError({ code: "NOT_FOUND", message: "Order not found" });
    await ctx.db.patch(orderId, updates);
  },
});

// ─── Store analytics ──────────────────────────────────────────────────────────

export const getStoreStats = query({
  args: { daysBack: v.number() },
  handler: async (ctx, args) => {
    await requireFulfillment(ctx);

    const orders = await ctx.db.query("storeOrders").order("desc").collect();
    const now = Date.now();
    const cutoff = new Date(now - args.daysBack * 24 * 60 * 60 * 1000).toISOString();

    const periodOrders = orders.filter((o) => o.orderDate >= cutoff);
    const totalRevenueCents = orders.reduce((s, o) => s + o.totalCents, 0);
    const periodRevenueCents = periodOrders.reduce((s, o) => s + o.totalCents, 0);
    const avgOrderCents = orders.length > 0 ? Math.round(totalRevenueCents / orders.length) : 0;

    // Best-selling products
    const productSales: Record<string, { name: string; qty: number; revenueCents: number }> = {};
    for (const o of orders) {
      for (const item of o.items) {
        const key = item.productName;
        if (!productSales[key]) productSales[key] = { name: item.productName, qty: 0, revenueCents: 0 };
        productSales[key].qty += item.quantity;
        productSales[key].revenueCents += item.unitPriceCents * item.quantity;
      }
    }
    const bestSellers = Object.values(productSales)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);

    // Revenue by day for the period
    const dayMap: Record<string, number> = {};
    for (const o of periodOrders) {
      const day = o.orderDate.slice(0, 10);
      dayMap[day] = (dayMap[day] ?? 0) + o.totalCents;
    }
    const revenueTrend = Object.entries(dayMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, amount]) => ({ date: date.slice(5), amount }));

    // Status breakdown
    const statusCounts: Record<string, number> = {
      pending: 0, processing: 0, shipped: 0, delivered: 0, cancelled: 0,
    };
    for (const o of orders) {
      statusCounts[o.status] = (statusCounts[o.status] ?? 0) + 1;
    }

    return {
      totalOrders: orders.length,
      periodOrders: periodOrders.length,
      totalRevenueCents,
      periodRevenueCents,
      avgOrderCents,
      bestSellers,
      revenueTrend,
      statusCounts,
    };
  },
});
