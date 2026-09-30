# Sombrey Commerce — Phase 6A (architecture & business rules)

Foundation only: no checkout, no StoreKit, no payment provider, no gating UI, no deployment.
Phase 6A adds a commerce **domain** (rules, data model, entitlements, events, security boundaries)
that 6B–6G build on.

> **PROVISIONAL — SUBJECT TO CHANGE.** Every price, policy, country and capability mapping in this
> document and in `convex/commerce/config.ts` is a launch assumption, not a business truth. Future
> sessions (and the future AI-agent system) must treat them as current settings to be revised with
> evidence — never as permanent rules.

## 1. What already existed (kept, untouched)

| Existing | What it is | 6A decision |
|---|---|---|
| `convex/commerce/subscriptions.ts`, `helpers.ts` | GOAT WALK web Premium via the **Hercules** commerce SDK (Stripe underneath); syncs `users.subscriptionTier` | Kept. Treated as *legacy access* in entitlements (§8). Not reused for the App Store membership. |
| `users.subscriptionTier`, `adminGrantedPremium`, `paymentStatus`, `customerId` | Legacy tiers, admin grants, offline payments | Kept; all writers are role-gated or internal. |
| `lib/roles.ts` `hasPremiumAccess()` | Current premium check (gates the AI coach) | Kept; feeds entitlements as `legacyPremium`. |
| `storeProducts`, `storeOrders`, `cartItems`, `inventoryLogs` | Admin-managed web merch store; owner-entered orders with free-text addresses | Kept. Not reused for the Band: admin-editable unvalidated prices, no product types, no payment/return states, orders created by staff not customers. Migration can be decided later. |
| `wearableDevices` | G69/QCBandSDK pairings; `deviceId` = the phone's CoreBluetooth UUID (not a Band serial) | Kept. Not proof of purchase; ownership can reference it (§9). |
| `analytics.ts`, `auditLogs` | Owner aggregate queries; admin action log | No product-event pipeline existed → `commerceEvents` (§10). |
| Account deletion (`users.deleteSelfAccount`) | Deletes personal data; **retains financial records**; never implies an Apple subscription was cancelled | Followed (§11). |
| `apps/website`, `apps/owner` | Boundary placeholders | Untouched. |

## 2. Provisional launch model — PROVISIONAL — SUBJECT TO CHANGE
- **Sombrey Band**: physical product, **$100 USD**, purchasable without a subscription, sold through
  a physical checkout (Apple Pay, Google Pay where supported, card) — **never** an App Store IAP.
- **Sombrey Membership**: **$30 USD/month**, auto-renewing, **no free trial**, starts when the customer
  agrees to purchase, cancellable any time; **no subscription refunds** offered.
- **Shipping** to US, GB, AE, CA, AU, LK; shipping and tax **paid by the customer**; **no rates set**.
- **Returns**: 30 days, unused Bands only.
- **Access**: neither → limited; Band only → Band experience + Vitals (no AI intelligence);
  subscription → subscription-level intelligence/features; both → everything. Final matrix: Phase 6D.

## 3. Configuration strategy (`convex/commerce/config.ts`)
One versioned object (`COMMERCE_CONFIG`, version `2026-10-provisional.1`) holds products, prices,
trial, countries, shipping/tax policy, returns, checkout methods, the capability matrix and the two
pending-decision flags. `validateCommerceConfig` checks it (integer cents, ISO 4217/3166 codes incl.
"UK"→GB, no invented rates, the Band can't be an App Store product, trial consistency, capability
matrix sanity); the test suite fails on any problem, so an invalid config can't ship.
Configuration is **code, not remote data**: deterministic in production, reviewed like code. There is
deliberately no database/remote override. A future experimentation or AI-agent system may *propose* a
new version; a human ships it. Orders snapshot the version they were created under.
`commerce/access:publicConfig` exposes prices, countries and policies (no internals).

## 4. Order model (`commerceOrders`, `convex/commerce/orders.ts`)
- Order number `SB-XXXXXXXX`; owner `userId` (set server-side); **snapshots**: line name, unit price,
  currency, config version, return policy. $100 → $89 later never changes a $100 order (tested).
- `shippingCents`, `taxCents`, `totalCents` are `null` until a provider quotes them; the total is
  computed only when both are known; amounts can't change once payment has started.
- Three state machines with explicit transition tables: **payment** (awaiting_payment → authorized/paid
  → refunded…), **fulfillment** (unfulfilled → processing → shipped → delivered; no delivery without
  shipping, nothing unpaid is fulfilled), **return** (none → requested → approved → received → refunded;
  eligibility = paid + delivered + within the sold-under window + an eligible condition).
- Tracking: `shipments[]` (carrier, tracking number, URL, status, shipped/delivered times).
- Provider references (`provider.name/checkoutSessionId/paymentId`) — provider undecided.
- Unsupported countries, the membership in a physical order, unknown products and bad quantities are
  refused.

## 5. Subscription model (`commerceSubscriptions`, `commerceSubscriptionHistory`)
One row per App Store original transaction: environment (production/sandbox), App Store product id,
original + latest transaction ids, status (active, in_grace_period, in_billing_retry, expired, revoked,
refunded), auto-renew, purchase/expiry/revocation dates, Apple's signed date, verification method and
time. Written **only** by `internal.applyVerifiedSubscription`, which accepts only trusted server-side
verification methods, only the configured App Store product (none configured yet → nothing can be
accepted), ignores older signed data, and refuses a transaction already bound to another account.
Every change appends to the history table (never rewritten). Access requires production data, active
or grace period, not expired. No Apple values are invented anywhere.

## 6. Future StoreKit 2 integration point (Phase 6B)
1. Create the product in App Store Connect; set `membership.appStoreProductId` (new config version).
2. App: StoreKit 2 purchase → send the signed transaction (JWS) to a new action.
3. Server: verify the JWS (Apple root chain) or call the App Store Server API; map to
   `VerifiedSubscriptionUpdate`; call `internal.commerce.internal.applyVerifiedSubscription`.
4. App Store Server Notifications v2 → an HTTP action verifies the signed payload → same mutation.
5. Account deletion stays separate from "Manage Subscription" (Apple's own surface).

## 7. Future physical checkout integration point (Phase 6C/6E)
Checkout action → `internal.createOrder` (prices from config) → provider quote → `internal.setQuote`
→ provider checkout (Apple Pay / Google Pay / card, card data only ever with the provider) → the
provider's **signed webhook** → `internal.applyPaymentUpdate` (paid creates Band ownership records) →
fulfilment/carrier flow → `internal.updateFulfillment` (tracking, delivered) → returns via
`internal.updateReturn`. The provider is a **decision point** (§12).

## 8. Entitlement model (`convex/commerce/entitlements.ts`)
Computed on every read (`commerce/access:myEntitlements`), never stored as a flag:
- **Band ownership** from ownership records (orders; staff grants; legacy pairings if enabled);
- **subscription** from verified App Store records (+ legacy premium if enabled);
→ **state** `none | band_owner | subscriber | band_owner_subscriber` → **capabilities** from the config
matrix: `band_experience`, `vitals`, `ai_intelligence`, `advanced_features`. Phase 6D asks
`has(entitlements, capability)`. Nothing is gated yet; existing gates (`hasPremiumAccess`) are unchanged.

## 9. Band ownership (`bandOwnership`, `convex/commerce/ownership.ts`)
Separate from orders (paid ≠ connected) and from `wearableDevices` (pairing). Statuses: purchased →
processing → shipped → delivered → activated → connected ⇄ disconnected; returned; cancelled — with a
transition table and history. Sources: `order`, `legacy_pairing`, `staff_grant`. **Activation** goes
through `ACTIVATION_METHODS`, which is **empty**: no mechanism (code, QR, serial, Bluetooth-first…) is
chosen; Phase 6G registers one and links the pairing via `activation.deviceRef`. The G69/QCBandSDK
pairing is untouched.

## 10. Events (`commerceEvents`, `convex/commerce/events.ts`)
Closed catalogue: product_viewed, band_purchase_initiated, band_checkout_abandoned,
subscription_purchase_initiated (**client**); band_checkout_completed, band_order_completed,
band_returned, subscription_activated / renewed / cancelled / expired (**server only** — a client can
never claim a purchase). Fields: name, time, account, platform, product, ISO country, a short source
label, amount + currency (server events only), config version. No names, emails, addresses, payment
data or free text; client events rate-limited (120/hour/user). Nothing acts on events: no experiments,
no price changes. Acquisition beyond a source label doesn't exist in Sombrey yet.

## 11. Security & privacy
- Clients can call only: `publicConfig`, `myEntitlements`, `myOrders`, `mySubscription` (all reads of
  their own data, no transaction ids or provider internals) and `recordEvent` (client events).
- Every change (create/price/pay/ship/deliver/return an order, subscription state, ownership) is an
  **internal** mutation enforcing the state machines — no client can mark paid/delivered, change a
  total, reassign an order, claim a Band, or set subscription state. Enforced by
  `tests/commerce/security.test.ts` against the source (no public mutation besides `recordEvent`; no
  file outside `commerce/internal.ts` inserts into protected tables).
- No card data is stored; payment credentials belong to the future provider.
- Account deletion: `commerceOrders`, `commerceSubscriptions`, `commerceSubscriptionHistory` are
  **retained** as financial records (like `storeOrders`); `bandOwnership` rows are deleted;
  `commerceEvents` lose the account link. Anonymising retained financial records (e.g. shipping
  addresses) is the existing pending retention-policy decision. Provider-side data (payment provider,
  Apple) needs provider-specific deletion handling once providers exist.

## 12. Unresolved decisions (need Jerrell)
1. **Physical payment provider** (must support Apple Pay, Google Pay, cards, the six countries, tax).
2. **Shipping rates and tax handling** (provider-calculated vs a tax service) — none set.
3. **Legacy access**: should GOAT WALK web Premium / coaching tiers / admin grants keep subscriber-level
   access (`legacyAccessGrantsSubscriberCapabilities`, currently **true**)?
4. **Already-paired Bands** (pre-commerce testers): count as ownership (`pairedDeviceCountsAsBandOwnership`,
   currently **true**) — or require a claim/activation?
5. **Purchased-but-undelivered** counts as owning a Band (currently yes).
6. **Activation mechanism** (Phase 6G).
7. **Final capability matrix** (Phase 6D), e.g. whether a subscriber without a Band gets Vitals.
8. **Retention/anonymisation** of retained order data after account deletion.
9. Whether the legacy merch store should later migrate into `commerceOrders`.

## 13. Not built in 6A
StoreKit 2, App Store products, purchase UI, checkout UI, Apple/Google Pay, card payments, carrier or
tracking APIs, paywall/gating UI, device activation, AI agents, pricing experiments, Settings, website.
