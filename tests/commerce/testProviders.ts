// ⚠️ TEST-ONLY PROVIDER ADAPTERS — Sombrey commerce, Phase 6J (not a test file).
//
// Deterministic stand-ins that implement the REAL provider interfaces
// (convex/commerce/providers.ts) so the end-to-end journeys can run the
// product's own flows (convex/commerce/flows.ts, quotes.ts) against something.
// They are NOT providers and can never become one:
//   • they live under tests/, which nothing in convex/ or apps/ imports
//     (checked by journeys.test.ts);
//   • every name starts with "TEST-ONLY", so a stored record could never be
//     mistaken for a real provider's;
//   • providersFor(COMMERCE_CONFIG) still returns null for every provider;
//   • their webhook "signatures" are HMACs under a key generated at runtime in
//     this process — they verify only against themselves, nothing is committed.
// Each adapter can be told to succeed, refuse, throw, hang (timeout), reply
// malformed, or do the work and then lose the response.

import { createHmac, randomBytes } from "node:crypto";
import {
  webhookTimestampAcceptable, type CreatedShipment, type FulfillmentProvider, type PaymentProvider, type ProviderRefusal,
  type ProviderShipmentEvent, type ShippingQuoteProvider, type TaxQuoteProvider, type VerifiedPaymentEvent,
} from "../../convex/commerce/providers.ts";

export type Mode = "ok" | "refuse" | "throw" | "timeout" | "malformed" | "lost_response";

const NEVER = () => new Promise<never>(() => undefined);
/** Applies a failure mode around a call that would succeed. */
async function behave<T>(mode: Mode, work: () => T, malformed: unknown): Promise<T | ProviderRefusal> {
  switch (mode) {
    case "refuse": return { ok: false, reason: "provider_error" };
    case "throw": throw new Error("TEST-ONLY provider: connection reset");
    case "timeout": return NEVER();
    case "malformed": return malformed as T;
    case "lost_response": work(); throw new Error("TEST-ONLY provider: response lost after the work was done");
    default: return work();
  }
}

/** Runtime-only signing (never committed); verification is HMAC + timestamp window. */
class TestSigner {
  private key = randomBytes(32);
  sign(body: string, at: number) { return { "x-test-signature": createHmac("sha256", this.key).update(`${at}.${body}`).digest("hex"), "x-test-timestamp": String(at) }; }
  verify(body: string, headers: Record<string, string>, now: number): boolean {
    const at = Number(headers["x-test-timestamp"]);
    if (!webhookTimestampAcceptable(at, now)) return false;
    const want = createHmac("sha256", this.key).update(`${at}.${body}`).digest("hex");
    return typeof headers["x-test-signature"] === "string" && headers["x-test-signature"] === want;
  }
}

// ─── Shipping & tax quotes ───────────────────────────────────────────────────

export function testShipping(opts: { amountCents?: number; mode?: Mode; currency?: string; expiresAt?: unknown } = {}): ShippingQuoteProvider & { calls: number } {
  const p = {
    name: "TEST-ONLY-shipping", calls: 0,
    async quote(req: { currency: string }) {
      p.calls++;
      return behave(opts.mode ?? "ok", () => ({ ok: true as const, amountCents: opts.amountCents ?? 1500, currency: opts.currency ?? req.currency, reference: `TEST-SHIPQ-${p.calls}`, detail: "TEST standard", ...(opts.expiresAt !== undefined ? { expiresAt: opts.expiresAt as number } : {}) }),
        { ok: true, amountCents: "fifteen", currency: req.currency });
    },
  };
  return p;
}

export function testTax(opts: { ratePct?: number; mode?: Mode; amountCents?: number } = {}): TaxQuoteProvider & { calls: number } {
  const p = {
    name: "TEST-ONLY-tax", calls: 0,
    async quote(req: { subtotalCents: number; shippingCents: number; currency: string }) {
      p.calls++;
      return behave(opts.mode ?? "ok", () => ({ ok: true as const, amountCents: opts.amountCents ?? Math.round(((req.subtotalCents + req.shippingCents) * (opts.ratePct ?? 8)) / 100), currency: req.currency, reference: `TEST-TAXQ-${p.calls}`, detail: "TEST tax" }),
        { ok: true, amountCents: -5, currency: req.currency });
    },
  };
  return p;
}

// ─── Payments ────────────────────────────────────────────────────────────────

type Session = { providerRef: string; idempotencyKey: string; amountCents: number; currency: string; captured: number; refunded: number };

export class TestPaymentProvider implements PaymentProvider {
  readonly name = "TEST-ONLY-payments";
  mode: Mode = "ok";
  refundMode: Mode = "ok";
  now: () => number;
  private signer = new TestSigner();
  private n = 0;
  sessions = new Map<string, Session>();              // by idempotency key
  refunds = new Map<string, { refundRef: string; providerRef: string; amountCents: number }>(); // by idempotency key
  charges = 0;                                         // real "money movements" at the provider

  constructor(now: () => number) { this.now = now; }

  async createSession(req: { orderNumber: string; amountCents: number; currency: string; idempotencyKey: string; methods: string[] }) {
    return behave(this.mode, () => {
      let s = this.sessions.get(req.idempotencyKey);
      if (!s) {
        s = { providerRef: `TEST-pay_${++this.n}`, idempotencyKey: req.idempotencyKey, amountCents: req.amountCents, currency: req.currency, captured: 0, refunded: 0 };
        this.sessions.set(req.idempotencyKey, s);
      }
      return { ok: true as const, providerRef: s.providerRef, clientHandoff: { testSession: s.providerRef } };
    }, { ok: true, clientHandoff: {} });
  }

  async refund(req: { providerRef: string; amountCents: number; currency: string; idempotencyKey: string }) {
    return behave(this.refundMode, () => {
      const existing = this.refunds.get(req.idempotencyKey);
      if (existing) return { ok: true as const, refundRef: existing.refundRef };
      const s = [...this.sessions.values()].find((x) => x.providerRef === req.providerRef);
      if (!s || s.refunded + req.amountCents > s.captured) return { ok: false as const, reason: "invalid_request" as const };
      s.refunded += req.amountCents;
      const r = { refundRef: `TEST-re_${++this.n}`, providerRef: req.providerRef, amountCents: req.amountCents };
      this.refunds.set(req.idempotencyKey, r);
      return { ok: true as const, refundRef: r.refundRef };
    }, { ok: true });
  }

  async verifyWebhook(rawBody: string, headers: Record<string, string>): Promise<VerifiedPaymentEvent | null> {
    if (!this.signer.verify(rawBody, headers, this.now())) return null;
    try {
      const e = JSON.parse(rawBody) as VerifiedPaymentEvent;
      return typeof e.eventId === "string" && typeof e.providerRef === "string" && typeof e.type === "string" && typeof e.amountCents === "number" && typeof e.currency === "string" ? e : null;
    } catch { return null; }
  }

  // ── what "the customer / the provider" does, producing signed webhooks ──
  /** The customer completes payment at the provider: money moves once per session. */
  customerPays(idempotencyKey: string, eventId = `TEST-evt_paid_${idempotencyKey}`) {
    const s = this.sessions.get(idempotencyKey)!;
    if (s.captured === 0) { s.captured = s.amountCents; this.charges++; }
    return this.webhook({ eventId, providerRef: s.providerRef, idempotencyKey, type: "paid", amountCents: s.amountCents, currency: s.currency });
  }
  refundSettles(idempotencyKey: string, full: boolean, eventId?: string) {
    const r = this.refunds.get(idempotencyKey)!;
    const s = [...this.sessions.values()].find((x) => x.providerRef === r.providerRef)!;
    return this.webhook({ eventId: eventId ?? `TEST-evt_${r.refundRef}`, providerRef: r.providerRef, idempotencyKey: s.idempotencyKey, type: full ? "refunded" : "partially_refunded", amountCents: r.amountCents, currency: s.currency });
  }
  webhook(event: VerifiedPaymentEvent, signedAt = this.now()) {
    const rawBody = JSON.stringify(event);
    return { rawBody, headers: this.signer.sign(rawBody, signedAt) };
  }
}

// ─── Fulfilment & tracking ───────────────────────────────────────────────────

type TestShipment = CreatedShipment & { idempotencyKey: string; direction: string; events: ProviderShipmentEvent[] };

export class TestFulfillmentProvider implements FulfillmentProvider {
  readonly name = "TEST-ONLY-fulfilment";
  mode: Mode = "ok";
  trackingMode: Mode = "ok";
  now: () => number;
  private signer = new TestSigner();
  private n = 0;
  shipments = new Map<string, TestShipment>(); // by idempotency key

  constructor(now: () => number) { this.now = now; }

  async createShipment(req: { idempotencyKey: string; direction: "outbound" | "return" }) {
    return behave(this.mode, () => {
      let s = this.shipments.get(req.idempotencyKey);
      if (!s) {
        const n = ++this.n;
        s = { ok: true, providerRef: `TEST-SHP-${n}`, carrier: "TEST-Carrier", service: "TEST standard", trackingNumber: `TESTTRK${String(n).padStart(6, "0")}`,
          trackingUrl: `https://tracking.test.invalid/TESTTRK${n}`, idempotencyKey: req.idempotencyKey, direction: req.direction, events: [] };
        this.shipments.set(req.idempotencyKey, s);
      }
      const { events: _e, idempotencyKey: _k, direction: _d, ...created } = s;
      void _e; void _k; void _d;
      return created as CreatedShipment;
    }, { ok: true, providerRef: "TEST-SHP-x", carrier: "", service: "standard" });
  }

  async cancelShipment() { return { ok: true as const }; }

  async getTracking(providerRef: string) {
    return behave(this.trackingMode, () => this.byRef(providerRef)?.events.map((e) => ({ ...e })) ?? [], { events: "none" } as unknown);
  }

  async verifyWebhook(rawBody: string, headers: Record<string, string>): Promise<ProviderShipmentEvent[] | null> {
    if (!this.signer.verify(rawBody, headers, this.now())) return null;
    try { const e = JSON.parse(rawBody); return Array.isArray(e) ? e : null; } catch { return null; }
  }

  byRef(providerRef: string) { return [...this.shipments.values()].find((s) => s.providerRef === providerRef); }
  /** The carrier scans the parcel: an event the provider will report (and webhook). */
  scan(providerRef: string, type: string, occurredAt: number, extra: Partial<ProviderShipmentEvent> = {}) {
    const e: ProviderShipmentEvent = { eventId: `TEST-scan-${providerRef}-${type}-${occurredAt}`, providerRef, type, providerStatus: `TEST:${type.toUpperCase()}`, occurredAt, ...extra };
    this.byRef(providerRef)!.events.push(e);
    return e;
  }
  webhook(events: unknown[], signedAt = this.now()) {
    const rawBody = JSON.stringify(events);
    return { rawBody, headers: this.signer.sign(rawBody, signedAt) };
  }
}
