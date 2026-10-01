# Sombrey Commerce — Phase 6J (End-to-end commerce validation)

The final Phase 6 phase: does the commerce system move correctly from one real-world state to the next,
as **one system**, without contradictory records, unauthorized access, duplicated state or fake success?
Validated with the product's own code end to end against test-only providers. No provider chosen, nothing
deployed, no UX redesign, no Bluetooth change.

## 1. Starting audit
Branch `feature/commerce-6j` from `c1bfe12` (6I). Read docs 6A–6I, all 36 `convex/commerce` modules, the
commerce tests and the iOS commerce layer. The docs matched the code, with two structural findings:
- **The provider-calling actions had never run in a test.** `beginPayment`, `requestQuote`,
  `submitFulfillment`, `refreshTracking`, `createReturnLabel` and `issueRefund` are Convex actions (not
  loadable in Node), so their orchestration was only covered by source checks.
- **There is no payment/shipment webhook route** (correct: there is no provider), and nothing defined how a
  verified payment event finds its order.

## 2. Architecture changes (validation-driven; behaviour unchanged unless listed in §3)
- `convex/commerce/flows.ts`: the actions' orchestration as plain functions (`requestQuoteFlow`,
  `beginPaymentFlow`, `paymentWebhookFlow`, `issueRefundFlow`, `submitFulfillmentFlow`, `returnLabelFlow`,
  `refreshTrackingFlow`, `shipmentWebhookFlow`). The actions are thin wrappers (auth + provider + Convex
  steps); the tests run the **same functions**. `paymentWebhookFlow`/`shipmentWebhookFlow` are what an HTTP
  route will run once a provider exists; an event finds its order through the attempt key it echoes
  (`orderIdFromAttemptKey`) — an unmatched event is never guessed onto an order.
- The staff "job" reads moved from Convex queries into the stores (`submissionJob`, `trackingRef`,
  `recordProviderShipment`, `returnLabelJob`, `refundJob`, `quoteDraft`) — the queries keep their staff /
  owner checks and call them.
- `callProvider` (providers.ts): every provider call is bounded (`PROVIDER_TIMEOUT_MS` = 20 s) and
  shape-checked.

## 3. Defects found by the journeys — fixed, with regression coverage
| # | Journey | Defect | Fix |
|---|---|---|---|
| D1 | Failure matrix | No provider call had a timeout: a hung provider held an action open until Convex killed it. | `callProvider` → `provider_error` after 20 s (all calls are idempotent by key, so retry is safe). |
| D2 | Failure matrix | A `null`/non-object provider reply made `computeQuote` **throw**; a non-numeric provider `expiresAt` made the quote's expiry **NaN**. | Replies shape-checked → "unavailable"; a provider expiry is honoured only if it's a real future time. |
| D3 | I.3 (webhook first) | After the verified webhook marked an order paid, a late client retry of `beginPayment` got the payment sheet **again**. | `reservePaymentAttempt` → `already_paid` for any paid-like order. |
| D4 | L (rejected) | Receiving a Band in a **non-refundable** condition ended the customer's ownership — but no refund is possible, so a rejected return left them with nothing. | A unit is taken back at receipt only if its condition is one the order's policy refunds (a replaced unit is always booked back in). |
| D5 | L | A return whose Band had **already been taken back** could still be rejected (no Band, no refund). | `rejectReturn` refuses once a unit is returned: "approve the refund instead". |
Each fix was reverted on purpose and the journeys failed, then restored (§12).

## 4. Test provider architecture
`tests/commerce/testProviders.ts` — **TEST-ONLY** adapters implementing the real interfaces: shipping and
tax quotes, `TestPaymentProvider` (sessions by idempotency key, captures, refunds by key, signed webhooks),
`TestFulfillmentProvider` (shipments by key, carrier scans, `getTracking`, signed webhooks). Each can
**succeed, refuse, throw, hang (timeout), reply malformed, or do the work and lose the response**. Webhook
"signatures" are HMACs under a key generated at runtime in the test process, checked with the production
replay window (`webhookTimestampAcceptable`); nothing is committed and nothing verifies outside the process.
Apple is the 6C harness (a throwaway certificate chain trusted only in-process).

## 5. Test fixture isolation
- Adapters live under `tests/`; a test walks `convex/` and `apps/ios/Sombrey/` and fails if anything there
  references test fixtures, `TEST-ONLY`, `memoryDb` or the Apple harness.
- Every adapter name starts `TEST-ONLY`; stored records could never pass for a real provider's.
- `providersFor(COMMERCE_CONFIG)` returns null for all four providers; every provider config value is
  `null`; `publicConfig.band.checkoutAvailable` is `false` (asserted).
- Journeys run on the in-memory database only; a test fails if any commerce test file references a Convex
  client, deployment URL or CLI. No fixture touched dev or production: no orders, ownership, revenue,
  shipments or provider configuration were created anywhere.

## 6. Journeys (tests/commerce/journeys.test.ts — 19 tests)
Each journey ends with the 6I integrity report (must be empty) plus: no impossible product references, no
return marked refunded beyond verified provider refunds, at most one revenue record per order.

| Journey | What's proven |
|---|---|
| **A Membership** | none → StoreKit transaction verified by the server with Apple → `subscriber`: Coach + Macro Calculator unlock, Band surfaces stay locked; a transaction for another account is refused; cancellation keeps Membership until expiry; expiry locks (server clock, then Apple's EXPIRED); restore re-verified → unlocked; Band ownership untouched; no local flag (EntitlementStore subscribes to the server, persists nothing). |
| **B Band purchase** | product + price from config; quote (test shipping/tax) with TTL expiry; no payment without a quote; frozen total; signed webhook → paid; fulfilment available; **paid ≠ owned**. |
| **C Fulfilment & tracking** | submitted → picked up → in transit → out for delivery → delivered via signed webhooks; carrier/tracking/ETA only from the provider; duplicate → `duplicate`; older event → `stale`; post-delivery → `after_terminal`; forged → rejected; customer tracking matches. |
| **D Activation** | refused before delivery; wrong code / another account refused; **payment, delivery and pairing don't create ownership; activation does**; Band surfaces unlock, AI stays locked; retry safe; pairing link only links an owned unit. |
| **E Band + Membership** | every surface (Home Band info, Vitals, Readiness, Strain, Sleep, Activity, History, Coach, Macro Calculator, Progress, Band & Membership management, Body Scan, Settings) per the 6D matrix. |
| **F Band only** | Membership expires: Band + history stay, AI locks, ownership records byte-identical. |
| **G Membership only** | AI available, Band locked, Band still offered, no ownership (pairing doesn't change it). |
| **H Free** | account, settings, pairing, logging, progress, Body Scan free; paid surfaces name what unlocks them. Surface→feature map checked against the real Swift gates and server enforcement (Coach, meal photos). |
| **I Order interruption** | (1) lost connection → webhook pays → reopen shows paid; (2) believed failure → same order, same session, one charge; (3) webhook before the client's response → bound by attempt key, late retry → `already_paid`; (4) duplicate → one transition, one revenue record; (5) conflicting → `conflict`, not applied, logged; stale replay → rejected; unmatched → never guessed. |
| **J Fulfilment interruption** | lost fulfilment response → one fulfilment; provider made the shipment but we never heard → retry → exactly one shipment; lost staff response → no second call; polling + webhook duplicates → one state, one record per event. |
| **K Replacement** | B replaces A via the staff replacement flow; exactly one active Band; A can't be reactivated (code or staff); A returned later; B untouched. |
| **L Return approved** | eligibility → request (ownership kept) → label only after authorization (retry same label) → in transit → received unused (ownership ends) → server-computed refund approved → provider refund requested (once) → **not refunded until the verified event** → refunded; duplicate event once; code dead for everyone. |
| **L Return rejected** | used Band: refund refused, owner keeps it, return rejected, nothing asked of the provider (D4); a taken-back Band can't be rejected (D5). |
| **M Refunds** | over-captured rejected; partial; duplicate; conflicting; a rejected event id is spent; full remainder; nothing after full; provider timeout ≠ refund; approval without confirmation stays unrefunded for days; delayed confirmation completes it; one open return per order, so a refund can only belong to one return. |
| **V2** | a test-only `SOMBREY_BAND_V2` (id, generation, SKU, price, name) through order, quote (provider gets the V2 SKU), payment, fulfilment, shipment, unit registration, activation, ownership, entitlement and analytics — no production code changed; production config doesn't know it. |
| **Cross-account** | A↔B both ways: can't view, quote, modify, pay, cancel, see returns, return, cancel returns, use activation codes, claim the other's Band by pairing link, or take the other's Apple subscription; membership per account; nothing of the other's changes. Roles: client/coach/assistant coach nothing; store manager fulfilment; owner/admin everything; every staff Convex function checks its level itself. |
| **Analytics** | the lifecycle records quote, payment started/completed, fulfilment, shipment, delivery, activation, return, refund — all server-origin; exactly one revenue and one refund record despite duplicate webhooks; only catalogued fields; no code, MAC, address, name, postcode, provider refs or signatures; revenue events can't be submitted by a client; logs redacted. |
| **Offline/recovery** | lost mutation responses are repeatable (same order); reconnect storms reuse the quote; stale quotes are never charged; app side: relaunch → "checking" (nothing cached), offline → unavailable or last-confirmed with a notice, orders/tracking kept and marked, activation success only from the server, live subscriptions. |
| **Failure matrix** | below. |

## 7. Provider failure matrix
| Provider | Failure | Result |
|---|---|---|
| Payment | timeout / throw / malformed | `payment_unavailable`; attempt kept, no ref; retry → same key → `ready` |
| Payment | duplicate webhook | `duplicate`, no change |
| Payment | conflicting webhook | `conflict`, recorded, not applied |
| Shipping | timeout / throw | quote incomplete (`provider_error`) → no payment |
| Shipping | malformed quote / null reply / bad expiry | `invalid_amount` / unavailable / expiry ignored |
| Tax | timeout | quote incomplete → no payment |
| Tax | invalid response | `invalid_amount` → no payment |
| Fulfilment | timeout / malformed | `provider_refused`, nothing recorded; retry → one shipment |
| Fulfilment | lost response | `provider_refused`; retry → the provider's same shipment, recorded once |
| Tracking | timeout | `provider_refused` |
| Tracking | duplicate / out-of-order / malformed | no-op / `stale` / skipped individually |
| Refund | timeout | `provider_refused`; not requested, not refunded |
| Refund | duplicate / conflicting event | once / `conflict` |

## 8. Lifecycles (summary)
- **Membership:** none → active (server-verified) → cancelled-but-active → expired → restored; grace and
  billing retry as 6C. Never local.
- **Band order:** draft → quoted (expires) → payment pending → paid (verified only) → fulfilment pending →
  shipped → delivered → (return…) → partially/fully refunded.
- **Shipment:** label → picked up → in transit → out for delivery → delivered (forward only, carrier time).
- **Device:** registered → assigned → activated → replaced | returned | deactivated → retired.
- **Ownership:** created only by activation; ends by replacement, return receipt (refundable condition) or
  verified refund (by config); never by Membership.
- **Return:** requested → authorized → in transit → received → refund approved → refunded | rejected.
- **Refund:** approved (server amount) → requested (provider, by key) → refunded (verified event only).

## 9. Real-provider dependencies (still required)
- **Payment provider: not selected.**
- **Shipping provider: not selected.**
- **Tax provider: not selected.**
- **Fulfilment provider: not selected.**
- **Real provider webhooks: not configured** (no HTTP route; the flows are ready).
- **Real production checkout: not enabled** (`checkoutAvailable: false`; no checkout UI).
Passing test adapters does **not** mean commerce is live. Each real adapter must implement the interfaces,
verify signatures and the replay window, echo the attempt key in payment events, and be wired in
`providersFor` and an HTTP route.

## 10. Physical hardware boundary
Unchanged: QCBandSDK, pairing, Sport+, BLE reconnect, MAC reading. **Deferred physical validation:** the
pairing link — after pairing, read the Band's MAC and call `myDevices:linkPairing` to link it to the
already-activated unit. The backend side is tested (D, cross-account); the app side needs a real Band.

## 11. Validation
- Commerce suite **195/195** (176 before 6J + 19 journeys); security 7, App Store security 14, hardening
  17, journeys 19. Regression: crash (ios) 2, readiness 25, activity 37, exercise 18, progress 16,
  intelligence 89, nutrition 91 — all passing.
- Convex typecheck clean. Lint clean for `convex/commerce`, `tests/commerce` and `tests/ios`. The 10
  repo-wide lint errors are in untouched files (`users.ts`, `measurements.ts`, `strain/*`, an intelligence
  test).
- Swift: no Swift changes in 6J. Local harness 156/156 (pure models). Codemagic build #11
  (`sombrey-ios-compile-check`, at `c1bfe12`) compiled this exact iOS tree; Swift tests were **compiled, not
  executed**. No new build was needed.

## 12. Intentional breaks (each caught, then restored)
already-paid check removed → I; condition check at receipt removed → L rejected; reject guard removed →
L; provider shape guard removed → failure matrix; quote-expiry validation removed → failure matrix; a
staff check removed from `approveRefund` → cross-account.

## 13. Remaining limitations
- Providers and webhook routes don't exist (§9). On-device offline/relaunch behaviour is covered by model
  tests and source checks, not run on a device or simulator. The Swift unit tests have been compiled by
  Codemagic but have only ever executed through the local harness (pure models).
- The integrity report has no UI and is bounded (2,000 rows/table).
- A one-off run during 6J showed 8 commerce failures that didn't reproduce in 6+ subsequent runs (most
  likely the App Store tests' wall-clock certificate timing under load); noted, not hidden.

## PHASE 6 STATUS
**PHASE 6 COMMERCE (6A–6J): COMPLETE — as an architecture.** Every required journey, failure, security,
integrity, analytics, isolation and regression check passes against the product's own code, and the
defects the journeys exposed are fixed with regression coverage.
**It is not live and not launch-ready:** no payment, shipping, tax or fulfilment provider is selected, no
webhook is configured, production checkout is disabled, nothing is deployed, and the pairing link awaits
hardware validation. Those are the next stage's dependencies, not open Phase 6 defects.
