# Sombrey Commerce — Phase 6E (physical Band commerce foundation)

The server-authoritative, provider-agnostic boundary for selling the Sombrey Band: product, draft
orders, quotes, payment attempts and verified payment events. **No provider is chosen, nothing is
purchasable, nothing is deployed, no UI was built.** Fulfilment/tracking is 6F; ownership, activation and
stable device identity are 6G. Bluetooth integration and the BLE name are untouched.

> **PROVISIONAL — SUBJECT TO CHANGE.** Band $100 USD · ships to US, GB, AE, CA, AU, LK · customer pays
> shipping and tax · 30-day returns, unused · Band without membership allowed. All in
> `convex/commerce/config.ts` (version `2026-10-provisional.3`).

## 1. What 6E adds to 6A–6D (nothing duplicated)
6A already had config-priced order drafts with snapshots, address validation, the payment/fulfilment/return
machines and internal order mutations. 6E adds: the product's SKU/category/generation; checkout settings;
an explicit "no inventory source"; the provider interfaces; quotes with expiry; the customer checkout API;
idempotent payment attempts; verified, deduplicated payment events; and a derived order stage.

## 2. Product (`config.ts products.band`)
`id: "sombrey_band"` (stable internal id used by orders/events) · `sku: "SOMBREY_BAND_V1"` ·
`category: "physical_band"` · `hardwareGeneration: "V1"` · `displayName: "Sombrey Band"` · `priceCents:
10000` · `currency: "USD"` · `active` · `maxQuantityPerOrder: 5` · `channel: "physical_checkout"` (never
App Store). Shipping countries and the return policy are the shared config sections. `publicConfig.band`
adds `sku` and `checkoutAvailable` (false until a payment provider exists). Validation adds SKU format and
an overflow guard (price × max quantity must be an exact integer).

**Inventory:** `inventory: { provider: null }` — stock is not tracked; nothing reports stock (tested).

## 3. Orders, snapshot, integrity
`startBandCheckout` builds the draft with 6A's `buildOrderDraft`: product, quantity (integer 1–5), unit
price, currency, config version and return policy are snapshotted. The client never sends a price, total,
currency, shipping, tax, status or owner. A draft is only quoted/paid while it is still priced as the
config prices it today (`draftStillCurrent`) — a price change means a new checkout, never a silent
re-price. Once a payment attempt starts, the quoted total is frozen on the attempt.

## 4. Shipping and tax (`providers.ts`, `quotes.ts`)
`ShippingQuoteProvider` (destination + lines → amount, service, reference, expiry) and `TaxQuoteProvider`
(destination + lines + subtotal + shipping → amount, jurisdiction) — tax is quoted after shipping. With no
provider: `{ status: "unavailable", reason: "provider_not_configured" }` and `totalCents: null`. Provider
values are rejected if not an integer 0–$100,000, in another currency, or the provider errors.

## 5. Quote lifecycle
request (owner check, open draft) → validate product/quantity/destination (from the draft) → subtotal
(snapshot) → shipping quote → tax quote → total (only if both) → stored on the order → expires after
`quoteTtlMinutes` (15) or sooner if a provider says so. A new address drops the quote. Payment needs a
complete, unexpired quote. Event `band_quote_requested` (country + product only).

## 6. Shipping address
6A's `shippingAddress` (recipient, line 1–2, city, region, postal code, country, phone) — only what
fulfilment needs. Stored only on the user's own orders; returned only by `myOrders` to its owner; never in
events (tested), never logged (no `console.*` in checkout code, tested). Changeable only before payment.

## 7. Payment-provider boundary — DECISION REQUIRED
`PaymentProvider`: `createSession({orderNumber, amountCents, currency, idempotencyKey, methods})` →
`{providerRef, clientHandoff}` (what the app needs to show Apple Pay / Google Pay / card — never card
data), and `verifyWebhook(rawBody, headers)` → a signed event or null. `providersFor(config)` returns null
for all three, so `beginPayment` returns `payment_unavailable` and nothing is reserved or charged. No
webhook route exists yet: there is nothing to verify signatures with. To decide: the payment provider
(Apple Pay + Google Pay + cards, the six countries, USD), whether it also provides tax (or a separate tax
service), and the shipping/fulfilment partner that quotes rates. Then: implement the interfaces, register
them in `providersFor`, add the webhook HTTP route calling `internal.commerce.internal.applyPaymentUpdate`.

## 8. Order states
6A's three machines stay the source of truth; `orderStage` derives the customer view:
`draft → quote_ready → payment_pending → paid → fulfillment_pending → shipped → delivered →
return_requested/approved/received → refunded` (+ `cancelled`, `payment_failed`, `delivery_failed`).
6E moves orders up to `paid` (and refunds, from verified events). Shipped/delivered/returns are 6F.
Change to the 6A table: `failed → paid` is now allowed — a provider may report a failed charge and later
the same payment as paid (retry); that verified event must be recorded, not dropped.

## 9. Idempotency
- **Double tap / retry / relaunch:** `startBandCheckout(requestKey)` — one order per (account, key).
- **Open checkouts:** at most 3 unpaid, uncancelled checkouts per account.
- **Payment:** one attempt per quote; a retry returns the same attempt and the same provider idempotency
  key (`orderId:quoteId`), so the provider returns the same session — no second charge.
- **Webhooks:** `commercePaymentEvents` records each (provider, eventId) once; duplicates change nothing.
- **Timeouts:** an attempt stays reserved after a provider error; the order keeps its state for resumption
  (`myOrders` now returns `orderId` and `stage`).
- Every check-then-write is one serializable Convex mutation.

## 10. Verified payment events (`applyVerifiedPayment`, internal only)
Applied only for the order's own attempt (provider + provider ref); `paid`/`authorized` must equal the
frozen total exactly, in the same currency; full refunds the full amount; partial refunds less; the 6A
transition table decides the rest (paid can't become failed/cancelled; refunded is final). Every event is
recorded with its outcome (`applied`/`unchanged`/`rejected` + reason). `band_checkout_completed` (with the
amount) is recorded only here — the only revenue event.

## 11. Order ≠ ownership ≠ pairing
**Change:** 6A's `applyPaymentUpdate` created `bandOwnership` records ("purchased") on payment. Per 6E,
paying now creates **no** ownership, activation or pairing — 6G decides when an order becomes ownership
(e.g. on delivery or activation). A paid order therefore doesn't grant 6D Band features yet. Staff grants
(6D `grantBandOwnership`) stay separate and internal; there is no customer path to ownership.

## 12. Analytics
Server events (no address, name, payment data; no amount except revenue): `band_quote_requested`,
`band_payment_started`, `band_checkout_completed` (verified payment only). Client events unchanged
(`product_viewed`, `band_purchase_initiated`, `band_checkout_abandoned`). The app can't record server
events (tested). Facts for future analysis (conversion, abandonment, shipping/tax burden per country,
attachment, returns) are in orders, quotes and events; prices/payment/tax/shipping/availability change
only by a human editing `config.ts` — no agent path exists.

## 13. Removed
`internal.setQuote` (6A) — a second, unverified way to set shipping/tax; quotes now come only from
`requestQuote`. Nothing called it.

## 14. Files
New: `convex/commerce/providers.ts`, `quotes.ts`, `checkoutStore.ts`, `checkout.ts`;
`tests/commerce/checkout.test.ts` (20), `tests/commerce/memoryDb.ts` (shared test helper).
Changed: `config.ts` (product, checkout, inventory, v.3), `orders.ts` (failed → paid), `internal.ts`
(createOrder/applyPaymentUpdate via the store; setQuote removed; no ownership on payment), `access.ts`
(myOrders: orderId, stage, quote summary), `events.ts` + `validators.ts` + `schema.ts` (quote,
paymentAttempt, checkoutRequestKey, cancelledAt on orders; `commercePaymentEvents`; two server events),
`tests/commerce/config.test.ts`, `security.test.ts`, `access.test.ts`, `appStoreHarness.ts`.
No Swift changes.

## 15. Deferred
**6F:** shipments, carriers, tracking, delivery, fulfilment provider, the return workflow and refunds to
customers. **6G:** ownership from orders, activation, stable physical identity (MAC/serial — see the
Bluetooth audit), the BLE rename. **Later:** the checkout UI, the webhook route (with the provider),
cleanup of abandoned drafts.
