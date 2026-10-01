# Sombrey Commerce — Phase 6F (fulfilment, shipping, tracking & returns)

The backend for **paid order → fulfilment → shipment → tracking → delivery → return/refund**. Provider
-agnostic and honest: **no fulfilment, carrier or payment provider is selected**, so nothing can actually be
submitted, shipped, tracked, labelled or refunded yet — every provider-backed action says
`…_unavailable`. Nothing deployed; no UI; no Swift changes. Ownership, activation and device identity are
6G.

> **PROVISIONAL — SUBJECT TO CHANGE.** 30-day returns for an unused Band, counted from delivery ·
> customer pays shipping and tax · ships to US, GB, AE, CA, AU, LK · no subscription refunds. All in
> `convex/commerce/config.ts` (version `2026-10-provisional.4`).

## 1. Architecture
```
ORDER (6A machines: payment · fulfillmentStatus · returnStatus — the source of truth)
  ├── FULFILMENT  commerceFulfillments   original | replacement, lines (product id + qty)
  │      └── SHIPMENT commerceShipments  one package; outbound or return; carrier data from the provider
  │             └── EVENTS commerceShipmentEvents  verified carrier events, once each, with outcome
  └── RETURN      commerceReturns        requested → … → refunded, rolls up into returnStatus
ORDER ≠ PAYMENT ≠ FULFILMENT ≠ SHIPMENT ≠ DELIVERY ≠ OWNERSHIP ≠ PAIRING
```
Writers: `fulfillmentStore.ts` (fulfilments, shipments, carrier events) and `returnsStore.ts` (returns,
refund approval/completion) — reachable only from role-checked staff functions (`staff.ts`), the
customer's own-order API (`orderTracking.ts`), and verified internal events (`internal.ts`). Rules are
pure in `fulfillment.ts`. Each write is one serializable Convex mutation.

**Removed from 6A:** `internal.updateFulfillment` / `updateReturn` (coarse setters that stored shipments
inline on the order, stamped delivery with the server clock, and moved order-sourced Band ownership on
ship/deliver/return) and `moveOwnershipForOrder`. The inline `order.shipments` field is no longer written
(kept in the schema for compatibility) and `myOrders` no longer returns it.

## 2. Fulfilment
`commerceFulfillments`: order, owner, kind (`original` | `replacement` + `replacesFulfillmentId`), lines
(order-line product ids + quantities — never "a Band V1"), status, idempotency key, provider, provider ref,
location, failure, timestamps (created, submitted, shipped, delivered, cancelled). Status:
`pending → submitted → shipped → delivered`, `→ failed` (returned to sender), `→ cancelled` (before the
carrier has it). Only a **paid** order (not cancelled, refunded or mid-return) gets an original
fulfilment, never for more than it has left to fulfil; the same key returns the same fulfilment.
Replacements need a delivered/failed fulfilment of the same order, can't exceed what it sent, and never
change the order's delivery, payment or ownership.

## 3. Shipments
`commerceShipments`: order, owner, fulfilment or return, direction, provider + ref, idempotency key,
carrier, service, destination country, status, tracking number (only as issued; `[A-Za-z0-9-]{4,64}`),
tracking URL (https only), ETA (only if the provider gives one), shipped/delivered (carrier times), last
event time + raw provider status, created/updated. Several per order and per fulfilment. Same key → same
shipment. Statuses: `label_created, picked_up, in_transit, out_for_delivery, delivered, exception,
returned_to_sender, cancelled` (+ event `arrived_at_facility` → in transit).

## 4. Provider boundary (`providers.ts`)
`ShippingQuoteProvider` (6E) for rates; **`FulfillmentProvider`** (6F): `createShipment` (outbound or
return label; idempotency key), `cancelShipment`, `getTracking` (recovery), `verifyWebhook` (signature, then
events normalized onto Sombrey's types; null if unsigned/forged); **`PaymentProvider.refund`** (6F,
idempotent). `providersFor` returns null for all. **No webhook route exists** — there's no signature to
verify yet. When a provider is chosen: implement the interface, register it, add an HTTP route that calls
`verifyWebhook` then `internal.commerce.internal.applyShipmentEvent` per event.

## 5. Shipping availability & rates
Unchanged from 6E: rates only from a provider; invalid/negative/fractional/foreign/oversized/missing
values rejected; no rate → "unavailable", total unknown. Being a configured country doesn't make a
destination shippable — the provider's quote does (`no_service_to_destination`).

## 6. Carrier events, duplicates, ordering
Recorded once per (provider, event id) — duplicates return `duplicate` and do nothing (no second
delivery, analytics event or status move). Applied in **carrier time**: an event older than the shipment's
last applied event is `stale`; anything after `delivered`/`returned_to_sender`/`cancelled` is
`after_terminal`; unmapped statuses are `unknown_status`; no time → `invalid`; unknown provider ref →
`unknown_shipment`; cancel after pickup → `invalid`. All recorded with the provider's raw status for
support. Shipments roll up to fulfilments and to the order's 6A `fulfillmentStatus`, forward only:
shipped on first carrier movement, `delivery_failed` on an exception (and back to shipped on a newer
event), delivered when every package of every original fulfilment is — `order.deliveredAt` = the
carrier's delivery time of the last package.

## 7. Customer view (`orderTracking.ts`)
`orderTracking`: the stage (6E's `orderStage`, extended with `return_authorized` / `return_in_transit`),
steps confirmed → preparing → shipped → in transit → out for delivery → delivered — each true only from real
state — and per shipment either the carrier, tracking number, link, status, provider ETA and last update,
or `tracking: "unavailable"`. No invented progress or ETA. Also `returnOptions`, `requestReturn`,
`cancelReturn`. Own orders only; nothing else is accepted from the app.

## 8. Staff view (`staff.ts`) — backend for the future Owner Dashboard
Role-checked like `storeOrders.ts`: fulfilment/returns = owner, admin, store_manager; money = owner,
admin (`staffAccess.ts`). `fulfillmentQueue` (paid & unfulfilled, pending/failed fulfilments, shipments
needing attention — exception / past provider ETA / no carrier update for 72 h — and returns awaiting staff;
no addresses), `orderOperations` (one order with address, fulfilments, shipments, returns),
`createFulfillment`, `cancelFulfillment`, `cancelPaidOrder` (money), `submitFulfillment` /
`refreshTracking` / `createReturnLabel` (→ `fulfillment_unavailable` / `tracking_unavailable` /
`returns_unavailable`), `authorizeReturn`, `rejectReturn`, `receiveReturn` (with inspection),
`approveRefund` (money), `issueRefund` (money; → `refund_unavailable`).

## 9. Returns
Eligibility (server only): paid, delivered with a carrier delivery time, within **30 days of delivery**
(the order's snapshotted policy), product `returnable`, no other return, and the customer **states the
Band is unused**. Reasons are a closed list (no free text). Lifecycle:
`requested → authorized → in_transit (carrier picked up the return label) → received (staff inspection:
unused / used / damaged / incomplete) → refund_approved → refunded`, or `rejected` / `cancelled`
(customer, before the carrier has it — the option is not used up). Rolls up into 6A `returnStatus`
(6A table extended: requested/approved → none on cancellation; received → rejected after inspection).
**"Unused" is not detected automatically** — it's the customer's statement and a person's inspection;
there is no device telemetry for it (and 6F doesn't build any).

## 10. Refunds
Approval (owner/admin) needs an inspected, policy-eligible return; the amount is computed by the server —
returned lines × snapshot unit price — and capped at captured − already refunded. The request goes to the
payment provider (`issueRefund`, idempotency key `refund:<returnId>`); the return becomes **refunded only
when the provider's verified refund event** arrives (`applyPaymentUpdate`). Refund events now carry the
amount refunded **by that event**; `order.refundedCents` accumulates; the total can never exceed the
capture (6E test updated accordingly). No refund provider → `refund_unavailable`.
**Decision needed:** whether shipping and/or tax are refunded on a return (currently excluded).

## 11. Cancellation
Before payment: the customer (6E `cancelCheckout`). After payment and before the carrier has the parcel:
owner/admin `cancelPaidOrder` (fulfilments cancelled, order `fulfillmentStatus` → cancelled; payment
stays `paid` until a verified refund). After shipment: no cancellation — a return. Orders are never deleted.

## 12. Analytics (server events; product + country only)
`fulfillment_created` (source: original/replacement), `shipment_created` (source: outbound/return),
`shipment_delivered`, `delivery_exception`, `return_requested`, `return_received` (source: inspected
condition), `refund_completed` (amount — a verified refund). Never an address, name, postal code, phone,
tracking number or carrier reference (tested). 6A's `band_order_completed` / `band_returned` remain in the
catalogue but are no longer emitted.

## 13. Recovery
Provider timeout/unavailable → the action returns a status; nothing is marked done; retries use the same
idempotency keys (`ship:<fulfilment>:1`, `return:<return>:1`, `refund:<return>`) so the provider returns the
same shipment/refund. Partial success (provider created it, our write failed) → the retry records the same
shipment once. Missed/late webhooks → `refreshTracking`. Duplicates → harmless. Unknown statuses → recorded.
App closed → orders and returns persist; `myOrders`/`orderTracking` resume.

## 14. Inventory
Still not tracked (`inventory.provider: null`); no stock levels anywhere (tested).

## 15. Future products
Fulfilment, shipments and returns reference order lines by product id; product facts come from
`physicalProduct(config, id)` (`fulfillmentProfile`, `returnable`, `requiresActivation`, SKU) — no SKU or
Band assumption in fulfilment code (tested). Multi-package orders, replacements and per-product
returnability are supported; per-product return windows and carriers are config extensions.

## 16. 6G needs
Delivery is a fact here (`order.deliveredAt`, fulfilment/shipment delivered times) but grants nothing.
6G: when an order line becomes an owned device (delivery? activation?), activation, stable physical
identity (MAC/serial — Bluetooth audit), mapping physical units to fulfilments (incl. replacements and
returned units), ownership on return/refund, pairing, the BLE rename.
`ORDER → FULFILMENT → DELIVERY → 6G ACTIVATION → PHYSICAL IDENTITY → OWNERSHIP → PAIRING`.

## 17. Tests
`tests/commerce/fulfillment.test.ts` (23): config; product-agnostic code; paid-only fulfilment;
idempotent fulfilment (concurrent) and shipments; valid tracking only; carrier-time progression; duplicates;
stale and post-delivery events; unknown statuses/shipments; exception recovery; multi-package delivery;
cancellation rules; replacements; customer tracking (unavailable, no ETA); staff attention; staff roles;
eligibility (30 days from delivery, unused, once, own orders); full return → verified refund; refund
caps and used items; return cancellation; customer API can't ship/deliver/authorize/refund/inject;
every staff function checks roles; no PII in analytics, no logging, no hard-wired carrier.
Deliberately broken and caught: shipment idempotency, staff authorization, stale-event protection.
