# Sombrey Commerce — Phase 6I (Security, edge cases & recovery)

Hardening of 6A–6H against retries, races, stale state, unauthorized access, partial operations and
malformed provider data. No redesign, no provider chosen, no fake provider or signature, no change to
Bluetooth, pairing or the commerce UX beyond stale-state notices. Nothing deployed.

## 1. Audit — what was found and fixed

| # | Finding | Fix |
|---|---------|-----|
| F1 | Idempotency keys returned the earlier record even when the **request differed** (checkout, fulfilment, shipment, return, payment/shipment event ids). | Same key + same request → same result. Same key + different request → `CONFLICT` (event ids → outcome `conflict`, never applied, never recorded twice). Concurrent identical requests → one record (Convex serializable mutations; tested with bursts). |
| F2 | A payment webhook arriving **before** the provider's reference was stored was accepted for *any* reference from that provider. | `VerifiedPaymentEvent.idempotencyKey`: before the reference is bound, the event must echo the attempt's idempotency key; the reference is then bound and must match from then on. Malformed event ids/references are rejected. |
| F3 | Provider responses were trusted in shape: a "created" shipment with an empty carrier, or one malformed tracking event, could be stored half-filled or fail a whole refresh. | `normalizeCreatedShipment` / `normalizeProviderShipmentEvent` (fulfillment.ts) parse provider output before any mutation; malformed → refusal / skipped individually (counted, logged). `recordShipment` refuses empty carrier/service. |
| F4 | `submitFulfillment` after a **lost response** (provider created, app never heard) failed with "only a pending fulfilment…". | Already-submitted → `{ status: "submitted" }`; un-recorded → retried with the same provider key (same shipment). |
| F5 | A **replaced** Band couldn't be physically returned (replaced → returned was not a transition). | Allowed; ownership is untouched (it already ended as "replaced"; the replacement stays the one active Band). |
| F6 | Product-generation assumptions: order drafts, quotes, events and analytics read `products.band` directly. | Everything looks products up by id (`physicalProduct`, `physicalProducts`, `knownProductIds`). A second generation is a config entry (tested with a cloned config). |
| F7 | Every quote request called the shipping/tax providers — a double tap or retry loop floods providers and analytics. | `reusableQuote`: a quote made < 10 s ago (same config version, unexpired) is returned again. |
| F8 | The orders list showed an approved return as "Return approved" even when it was on its way (the detail showed it correctly). | `myOrders` derives the same `activeReturn` stage. |
| F9 | No way to see inconsistent records. | Read-only `auditCommerceIntegrity` + owner/admin query `commerce/staffIntegrity:integrityReport` (§6). |
| F10 | Webhook replay window undefined for future adapters. | `WEBHOOK_TOLERANCE_MS` (5 min) + `webhookTimestampAcceptable` (§4). |
| S1 | iOS: when the entitlement subscription failed, Membership/Band kept the session's last answer **without saying so**. | `EntitlementStore.refreshFailed` → "Couldn't refresh. Showing your last confirmed status." + Try again. (Gating still uses this session's answer — never "allowed" without one.) |
| S2 | iOS: an Orders/Order detail error **replaced** the loaded list with an error. | `LoadPresentation`: a failure keeps what was loaded, with "Couldn't refresh. Showing your orders as last loaded." |

Checked and already sound: owner-only reads (`visibleToCustomer`, `by_user` queries); staff role checks on
every staff query/mutation/action (`staffMay`); server-only revenue events; activation codes hashed only,
10 attempts/h, never logged; ownership only from activation; pairing never ownership; refunds cumulative and
never above captured; out-of-order/after-terminal carrier events recorded, not applied; account deletion
releases devices without deleting history.

## 2. Idempotency rules (all commerce writers)

| Operation | Key | Same request | Different request |
|---|---|---|---|
| Start checkout | client `checkoutRequestKey` per user | same order | `CONFLICT` (products/quantities; address until first edit) |
| Payment attempt | `${orderId}:${quoteId}` | same attempt → provider returns same session | n/a (one open attempt) |
| Payment event | provider event id | `duplicate` | `conflict` — not applied |
| Fulfilment | staff key | same fulfilment | `CONFLICT` (order, kind, lines, replaced fulfilment) |
| Shipment | `ship:{fulfilmentId}:1` / return key | same shipment | `CONFLICT` (direction, parent, provider, provider ref) |
| Shipment event | provider event id | `duplicate` | `conflict` — not applied |
| Return request | client key per user | same return | `CONFLICT` (order, reason, lines) |
| Refund | `refund:{returnId}` | provider dedupes | refund total capped at captured |
| Activation | code hash (single use) | `already_active` for the owner | refused for anyone else |

## 3. Recovery paths
- **Order:** payment `failed → paid` on a verified retry; `paid` never silently becomes unpaid; an
  interrupted checkout resumes by order id; the attempt keeps its key so retries never double-charge.
- **Fulfilment:** lost submit response → retry is safe (F4); missed webhooks → `refreshTracking` (staff),
  malformed events skipped; stalled tracking flagged after 72 h (`shipmentAttention`); cancel only before
  pickup.
- **Returns/refunds:** approval ≠ refund — a refund completes only on the provider's verified event;
  per-event amounts, cumulative, capped; ownership ends at receipt (or at refund, by config).
- **Devices:** wrong unit assigned → `unassignDevice` before activation; replacement takes over on
  activation; replaced unit can be returned (F5); deactivate/retire are owner/admin, audited.

## 4. Webhooks (for the adapter that will exist once a provider is chosen)
An adapter's `verifyWebhook` must: verify the provider's signature over the raw body with its secret
(env var, never committed); reject a timestamp outside `WEBHOOK_TOLERANCE_MS` or missing
(`webhookTimestampAcceptable`); normalize into `VerifiedPaymentEvent` (with the echoed `idempotencyKey`)
or `ProviderShipmentEvent`; return `null` for anything unverifiable. Inside the window, replays are
caught by event-id de-duplication; contents that differ under a known id are `conflict`. Unknown event
types are recorded (`unknown_event_type` / `unknown_status`), never applied; stale/out-of-order carrier
events are recorded as `stale`/`after_terminal`. No adapter, signature or fake provider exists today.

## 5. Rate limits
| Surface | Limit |
|---|---|
| Activation code attempts | 10 per user per hour (`devices.activationAttemptsPerHour`) |
| Open checkouts | 3 per user (`checkout.maxOpenCheckoutsPerUser`) |
| Quote requests | one provider call per order per 10 s (`QUOTE_REUSE_MS`) |
| Order quantity | `maxQuantityPerOrder` per product (5) |
| Client analytics | server-validated catalogue; revenue/ownership events server-only |
| App Store submissions | reserved per transaction (6C) |
Convex has no per-IP limiting; anything beyond the above belongs at the provider (e.g. checkout sessions).

## 6. Database integrity
`commerce/staffIntegrity:integrityReport` (owner/admin, **query** — cannot write) lists by id: total ≠
subtotal + shipping + tax; subtotal ≠ lines; refunded > captured; paid without an attempt; fulfilments,
shipments, returns without a parent; devices activated without a live ownership; devices with several live
ownerships; live ownership of an ended device. Over the most recent 2,000 rows per table (flagged
`truncated`; orphan checks are then suppressed). It never repairs: fixes go through the existing audited
staff mutations one record at a time. No migration, no bulk fix, no deletion of commerce history (the
only delete is account deletion clearing that user's activation-attempt rate-limit rows).

## 7. Analytics & logs
Client events carry product id + short labels only (codes, addresses, ids rejected — 6H). Operational
logs go through `logCommerce` (observability.ts): one JSON line, scalar fields, and any field whose name
suggests a code, credential, address, name, email, hardware id, receipt or token is dropped. Durable
outcomes stay in `commercePaymentEvents` / `commerceShipmentEvents` / `commerceEvents`.

## 8. Tests
- `tests/commerce/hardening.test.ts` (17): key conflicts + bursts for checkout/fulfilment/shipment/return;
  webhook-before-reference binding; event-id conflicts; malformed events/responses; replay window;
  replaced-unit return; the entitlement matrix per surface for all four states (with pairings present);
  a second Band generation via config; quote reuse; myOrders return stage; integrity report; read-only
  tooling; log redaction.
- `checkout.test.ts`: verified events now carry the attempt's key (+ a wrong-key case).
- Intentional breaks, each caught then restored: checkout key conflict check removed; webhook binding
  removed; replaced → returned removed.
- Swift: `CommerceModelsTests.failedRefreshKeepsWhatWasLoadedAndSaysSo` (local harness, compile via
  Codemagic).

## 9. Remaining limitations
- No payment, shipping, tax or fulfilment provider: signature verification, timestamp checks and event
  mapping are specified and tested at the boundary, not against a real provider.
- The integrity report is bounded (2,000 rows/table) and has no UI (Owner Dashboard is out of scope).
- Pairing link (MAC after pairing) still needs hardware validation; nothing here touches Bluetooth.
