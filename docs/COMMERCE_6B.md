# Sombrey Commerce — Phase 6B (StoreKit 2 membership layer)

The native iOS StoreKit 2 layer for **Sombrey Membership**, built on the Phase 6A foundation
(docs/COMMERCE_6A.md). No purchase UI, no gating, no server verification yet (6C), nothing deployed.

> **PROVISIONAL — SUBJECT TO CHANGE.** Membership: auto-renewing, monthly, **$30 USD/month**, no free
> trial, starts when the customer agrees, cancellable any time, no subscription refunds. These live
> in `convex/commerce/config.ts`; the app never hard-codes the price — it shows Apple's localized
> `displayPrice`.

## 1. What existed
Swift 6, iOS 17, SwiftUI app with Clerk (`ClerkKit` 1.5.x) + Convex; app-level `@Observable` models
injected with `.environment`; `os.Logger` diagnostics (subsystem `com.sombrey.app`, per-area
categories, never logging secrets); Swift Testing tests hosted in the app. **No StoreKit, no
`.storekit` file, no purchase or entitlement code** in the iOS app. The only premium logic is the
backend's `hasPremiumAccess` (legacy web Premium) — untouched.

## 2. Architecture
```
UI (6D) ──► MembershipManager (StoreKit 2 adapter, @Observable @MainActor)
                 │  loadProduct · purchase · start (Transaction.updates) · refreshStatus · restorePurchases
                 ▼
            MembershipModels (pure): config · facts · MembershipResolver · statuses/outcomes/errors
                 │                    ledger · MembershipAccountToken · handoff record
                 ▼
            MembershipServerHandoff ──► AwaitingServerVerification (6B: held, nothing sent)
                                         └─► 6C: a Convex action that verifies with Apple
```
Files: `apps/ios/Sombrey/Commerce/MembershipModels.swift` (StoreKit-independent rules),
`MembershipManager.swift` (StoreKit adapter), `MembershipDiagnosticsView.swift` (**DEBUG only**,
not linked from any screen). `SombreyApp` creates one `MembershipManager` and starts its transaction
listener at launch. The UI never touches StoreKit.

## 3. Product configuration
The product id is a **build setting**: `SOMBREY_MEMBERSHIP_PRODUCT_ID` → Info.plist
`SombreyMembershipProductID` → `MembershipProductConfig.configuredProductID`. It is **empty** in every
build today, so the manager reports `unavailable(.notConfigured)` and makes **no StoreKit calls** —
nothing is purchasable, nothing is faked.
**Insert the real id** (after it exists in App Store Connect) in two places, identically:
1. the iOS build setting `SOMBREY_MEMBERSHIP_PRODUCT_ID` (Secrets.xcconfig / Codemagic), and
2. `convex/commerce/config.ts` → `products.membership.appStoreProductId` (a new config version).

## 4. Product loading
`Product.products(for:)` → `MembershipResolver.productState`: `unavailable(.notConfigured |
.productUnavailable | .wrongProductType)`, `error(.storeUnavailable | .unknown)`, or
`available(facts)` — only then is anything purchasable. It checks the product exists and is
**auto-renewable**. The price shown is Apple's `displayPrice` (localized). If Apple's price differs
from the configured $30, the app still shows Apple's (what the customer is charged); the mismatch is a
configuration issue to fix in App Store Connect or `config.ts` — never papered over.

## 5. Purchase flow
`purchase()` → needs a loaded product and a signed-in account → `product.purchase(options:
[.appAccountToken(token)])` → `.success(verification)` / `.userCancelled` / `.pending`:
- verified → handled once (ledger), handed to the server seam, `finish()`ed, status refreshed;
- unverified → `failed(.unverified)`, not finished, **no access**;
- cancelled → `cancelled` (+ client event `subscription_checkout_abandoned`);
- pending (Ask to Buy / SCA) → `status = .pending`; the approval arrives via `Transaction.updates`.
Nothing marks the Sombrey subscription active: that happens only when the server verifies (6C).

## 6. Transaction verification
StoreKit 2's `VerificationResult` (Apple's JWS signature, checked on device) is mirrored as
`MembershipVerified`. Every resolution rule refuses unverified data: an unverified status or
entitlement is `.unverified` (never `.active`); an unverified purchase is `.failed(.unverified)`;
unverified updates are logged and ignored. The server will verify the signed transaction itself (6C)
and never trusts the phone's verdict.

## 7. Account association (`appAccountToken`)
`MembershipAccountToken.make(accountID:)` = RFC 4122 **UUID v5** (SHA-1, name-based) of
`"sombrey:clerk:" + <Clerk user id>` in the fixed namespace `155EA3DB-9DE4-4877-A417-FC8CDA0354AF`.
Deterministic (same account → same token on every device), distinct per account, one-way (doesn't
reveal the id), no email/name. The Clerk user id is the Convex identity `subject`, so **6C recomputes
the same token server-side** from the authenticated user. Reference vector (checked against Python's
`uuid.uuid5`): `"user_test"` → `96D212A9-D972-503E-8C18-87D719330709`. The namespace must never change.

## 8. Entitlement, listener, restore
- **Status** (`MembershipStatus`): `unavailable`, `loading`, `notSubscribed`, `active` (with expiry,
  auto-renew, grace-period flag, environment), `pending`, `billingRetry`, `expired`, `revoked`,
  `unverified`, `error` — from `product.subscription.status` (renewal state + verified renewal info),
  falling back to `Transaction.currentEntitlement(for:)`. `hasVerifiedAppleEntitlement` is true only
  for `active`. It is the **phone's reading of Apple's entitlement**, not Sombrey access.
- **Listener**: `Transaction.updates` from launch — renewals, cancellations (auto-renew off),
  refunds/revocations, Ask-to-Buy approvals, purchases on other devices, re-deliveries after relaunch.
  A transaction is handled once per launch (`MembershipTransactionLedger`); finishing is idempotent;
  the server dedupes by transaction id (6C).
- **Restore**: `AppStore.sync()` → re-read → `restored(active) | nothingToRestore | failed(error)`;
  the current verified entitlement's signed transaction is handed to the server seam (works after
  reinstall / on another device with the same Apple ID; the token links it to the Sombrey account).

## 9. Local StoreKit testing (development only)
`apps/ios/StoreKitTesting/SombreyStoreKitTesting.storekit` — a subscription group "Sombrey Membership —
StoreKit TESTING ONLY" with product `sombrey.storekit_testing.membership_monthly` (1 month, $30.00, no
intro offer). It is **not** in the app target and only affects Xcode runs:
1. In `Secrets.xcconfig`: `SOMBREY_MEMBERSHIP_PRODUCT_ID = sombrey.storekit_testing.membership_monthly`.
2. Xcode › Product › Scheme › Edit Scheme › Run › Options › StoreKit Configuration → select the file.
3. Run a Debug build; present `MembershipDiagnosticsView` temporarily (or its preview); use Xcode's
   Transaction Manager to approve Ask-to-Buy, refund, expire, fail renewals.
Transactions have `environment = xcode`; they never reach production and nothing is sent to Convex.
Never ship a build with the testing id.

## 10. Errors and diagnostics
`MembershipError`: notConfigured, productUnavailable, wrongProductType, storeUnavailable, notSignedIn,
userCancelled, pending, unverified, revoked, expired, purchaseNotAllowed, unknown(code) — each with a
calm `userMessage` (no raw StoreKit text). Logs: `CommerceDiagnostics` (category "commerce"): product
load, purchase initiated/cancelled/pending, verified/unverified transaction (id as a 4-digit suffix),
entitlement changed, restore — never JWS payloads, payment data or account ids.

## 11. Commerce events
Client events only, via `commerce/access:recordEvent`: `subscription_purchase_initiated`,
`subscription_checkout_abandoned` (added to the 6A catalogue in 6B), `product_viewed`
(`noteMembershipViewed`). **Off** (`CommerceBackend.available = false`) until the commerce backend is
deployed in 6C — the app never calls a function that doesn't exist. Activation/renewal/cancellation/
expiry events remain server-only (enforced by tests/commerce/security.test.ts).

## 12. Handoff to Phase 6C
1. A Convex action `commerce/appStore:submitTransaction(signedTransaction)` (client-callable,
   authenticated): verify the JWS against Apple's root certificates (or query the App Store Server API
   by transaction id), check bundle id, product id (= config), environment, and that
   `appAccountToken == uuidv5(namespace, "sombrey:clerk:" + identity.subject)`; map to
   `VerifiedSubscriptionUpdate`; call `internal.commerce.internal.applyVerifiedSubscription`.
2. App Store Server Notifications v2 → HTTP action → verify the signed payload → same mutation
   (renewals, expiry, refunds, billing retry, grace period) — idempotent by transaction id.
3. Replace `AwaitingServerVerification` with a client of (1); set `CommerceBackend.available = true`.
4. Set the App Store product id (config + build setting). Deploy the commerce backend (not before).

## 13. App Store Connect — still required (nothing configured yet)
- Paid Applications agreement, tax and banking completed.
- Subscription group (e.g. "Sombrey Membership").
- Auto-renewable subscription: reference name, **product id** (decide once — it can't be reused),
  duration **1 month**, price **$30 USD** (other storefronts per decision), **no introductory offer /
  free trial**, localized display name + description, review screenshot and review notes.
- App Store Server Notifications v2 URL (6C) and an App Store Server API key (6C).
- Sandbox testers for device testing.

## 14. Build and tests
- Swift unit tests: `SombreyAppTests/MembershipTests.swift` (13), run locally through a harness against
  the pure core; the Xcode test target is compiled by the compile-check workflow (§15).
- `tests/commerce` (Node): 28 incl. two source-level checks of the iOS layer.
- New Codemagic workflow `sombrey-ios-compile-check`: manual, **unsigned, no upload, no Convex** —
  compiles Release and Debug build-for-testing only. The Body Scan dev workflow isn't on this branch
  and would upload to TestFlight, so it wasn't used.

## 15. Unresolved
- The App Store product id and storefront prices (App Store Connect).
- Whether a subscription bought under one Sombrey account may be used by another account on the same
  Apple ID (6C policy; the token records which account bought it).
- The membership UI, restore entry point and access gating — **Phase 6D**. Final subscription access
  gating belongs to 6D; nothing in 6B gates any feature.
