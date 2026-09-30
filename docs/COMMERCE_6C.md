# Sombrey Commerce — Phase 6C (StoreKit server verification & subscription backend)

Server-side verification of Apple subscription data and its synchronisation into the Phase 6A commerce
records, connected to the Phase 6B StoreKit layer. **Nothing deployed, nothing purchasable, no App Store
product created.** The system stays "not configured" until the real product id and Apple credentials are
supplied (§10). Phase 6D (access matrix / gating / UI) has not started.

> **PROVISIONAL — SUBJECT TO CHANGE.** Membership: auto-renewing, monthly, $30 USD/month, no free trial,
> no introductory offer, cancellable any time, no subscription refunds offered by Sombrey (Apple may still
> refund — Sombrey then records `refunded`). Band $100, sold separately. These live in
> `convex/commerce/config.ts`, not in 6C code.

## 1. Principle
The iPhone is never the authority. The app sends **only Apple's signed transaction (JWS)**; the server
verifies it against Apple's root certificate, checks it belongs to the **authenticated** Sombrey account,
then asks **Apple's server** for the subscription's current state and records that. The app then **reads**
its membership from the server (`commerce/access:myEntitlements`). A successful submission is never access.

```
Apple ─ StoreKit 2 ─► app ─ JWS ─► commerce/appStore:submitTransaction (authenticated action)
                                     ├─ SignedDataVerifier (Apple's library): x5c → Apple Root CA - G3, ES256,
                                     │   bundle id, environment
                                     ├─ product / type / family-sharing checks
                                     ├─ appAccountToken == uuidv5(ns, "sombrey:clerk:" + identity.subject)
                                     └─ App Store Server API: Get All Subscription Statuses → signed tx + renewal
                                         info → verified again, same checks → status
                                               ↓
Apple ─ App Store Server Notification V2 ─► POST /apple/app-store-notifications (convex/http.ts)
                                     └─ commerce/appStore:processNotification (internal) → verify → classify
                                               ↓
                 internal.commerce.internal.applyVerifiedSubscription / applyAppStoreNotification
                 → commerce/subscriptionStore.ts (the ONE writer; 6A rules in subscriptionState.ts)
                 → commerceSubscriptions (current) + commerceSubscriptionHistory (append-only)
                 → commerce/access:myEntitlements (server-derived) → app
```

## 2. What was reused (no parallel system)
- 6A `subscriptionState.ts` rules (`validateVerifiedUpdate`, `applyVerifiedUpdate`, `grantsAccess`) — extended.
- 6A `internal.applyVerifiedSubscription` — same function, same purpose; its body moved to
  `subscriptionStore.ts` so the notification mutation shares it instead of duplicating it.
- 6A `commerceSubscriptions` / `commerceSubscriptionHistory` / `commerceEvents` — extended with optional
  fields; the closed event catalogue is unchanged.
- 6A `entitlements.ts` / `myEntitlements` — the only entitlement system.
- 6B account token (namespace `155EA3DB-…`, prefix `sombrey:clerk:`, UUID v5) — reimplemented server-side,
  byte-identical (reference vector and a cross-language check in tests).
- 6B `MembershipManager` / `MembershipModels` — the hand-off seam now has a real implementation.

## 3. Files
Backend (new): `convex/commerce/appStore.ts` (actions), `appStoreFlow.ts` (verification flows),
`appStoreRules.ts` (checks, status derivation, notification catalogue), `appStoreVerifier.ts` (Apple's
library), `appStoreConfig.ts` (configuration, pinned Apple root), `accountToken.ts`, `subscriptionStore.ts`.
Backend (changed): `internal.ts`, `access.ts`, `subscriptionState.ts`, `entitlements.ts`, `validators.ts`,
`schema.ts`, `http.ts`, `users.ts` (deletes the token link on account deletion); `records.ts` removed (its
mapper lives in `subscriptionStore.ts`). Dependency: `@apple/app-store-server-library@3.1.0` (Apple, MIT).
iOS (changed): `Commerce/MembershipModels.swift`, `Commerce/MembershipManager.swift`,
`SombreyAppTests/MembershipTests.swift`.
Tests (new): `tests/commerce/appStoreVerification.test.ts`, `appStoreStore.test.ts`,
`appStoreSecurity.test.ts`, `appStoreHarness.ts`; `security.test.ts` updated for the 6C boundaries.

## 4. Verification (what is checked, and where the value comes from)
| Fact | Source | Check |
|---|---|---|
| Authenticity | JWS x5c chain → **Apple Root CA - G3** (pinned, SHA-256 `63343ABF…3E9179`), Apple's leaf/intermediate marker OIDs, ES256 | `SignedDataVerifier`; OCSP revocation checks on (online) |
| Bundle id | signed payload | `com.sombrey.app` |
| Environment | signed payload | in `APPLE_ALLOWED_ENVIRONMENTS`; Xcode/local never |
| Product | signed payload | = `config.ts` `appStoreProductId` (null → nothing accepted) |
| Type | signed payload | `Auto-Renewable Subscription`; `inAppOwnershipType` `PURCHASED` |
| Account | signed `appAccountToken` | = token derived from the caller's Clerk id (submissions); linked account (notifications) |
| Transaction / original transaction | signed payload | numeric ids; renewal info must match the original transaction |
| Purchase / expiry / revocation / grace | Apple's **current** signed data (Server API or notification) | never the app's copy |
| Status / auto-renew | Server API status + signed renewal info; notification type | derived (§7) |
| App's Apple ID (Production) | signed notification | = `APPLE_APP_APPLE_ID` |

Never trusted from the client: price, expiry, active flag, status, account id, product name — the action's
only argument is `signedTransaction`. Nothing stores signed payloads, prices, currency or payment data.

## 5. Account token
`accountToken.ts` recomputes the 6B token from `identity.subject` (the Clerk user id) with Web Crypto.
Submissions: Apple's signed token must equal it, else `rejected (other_account)` — before Apple's server is
even asked. A stored subscription's token can never change (`applyVerifiedUpdate` refuses), and a
subscription can never move to another user (`writeVerifiedSubscription` refuses). Consequences:
- same account on a new device / after reinstall → same token → same subscription, nothing new to buy;
- another Sombrey account on the same Apple ID → refused (the purchase stays with the buyer's account);
- purchases without a token (e.g. redeemed outside the app) → refused (see §12).
`commerceAppAccountTokens` maps a token to its account so notifications can be matched. Rows are written
only with a server-derived token: by `submitTransaction` and by `commerce/access:linkAppStoreAccount`
(no arguments; the app calls it just before a purchase).

## 6. Recording and idempotency
`subscriptionStore.writeVerifiedSubscription` (internal mutations only) validates, binds, writes the current
record, appends history and records the 6A server event. Guarantees:
- **one record per original transaction** — each write is one serializable Convex transaction that looks up
  `by_original_transaction` before inserting (Convex has no unique indexes; this is how uniqueness holds);
- **same state again → no write, no history** (`sameState`), only `lastVerifiedAt` refreshed: repeated app
  submissions, restore, second device, app-then-notification and notification-then-app;
- **older signed data never overwrites newer** (`signedDate` ordering): late retries and out-of-order
  deliveries are `stale`;
- **each notification once** — `commerceAppStoreNotifications` by `notificationUUID`, checked and written in
  the same transaction as the subscription change, so concurrent duplicate deliveries are harmless;
- per-account budget of 30 submissions/hour (each is an App Store Server API call) → `retry_later`.
Stored per subscription: user, original/latest transaction ids, App Store product id, Sombrey product id,
environment, purchase and expiry dates, status, auto-renew, revocation date, grace-period end, account token,
Apple's signed date, verification method, last verified / created / updated times. Config version is on events.

## 7. Status and history
Status (6A set): `active`, `in_grace_period`, `in_billing_retry`, `expired`, `revoked`, `refunded` — from the
Server API status (1 active, 2 expired, 3 billing retry, 4 grace, 5 revoked) or, for notifications, from the
signed transaction + renewal info (revocation → refunded/revoked, billing retry with a future grace end →
grace, retry → billing retry, else by expiry). Access (`grantsAccess`): active or grace (until the grace
period ends), not revoked, not expired; sandbox only where `COMMERCE_SANDBOX_GRANTS_ACCESS=true`.
History rows (append-only) record the event, source, status, expiry, auto-renew, transaction, product and,
for notifications, Apple's UUID/type/subtype. Events are Apple's own words; an app submission only says
`verified_with_apple` — it never claims a renewal or cancellation Apple didn't announce.

## 8. Notifications handled
| Apple type (subtype) | History event | Effect |
|---|---|---|
| SUBSCRIBED (INITIAL_BUY / RESUBSCRIBE) | purchased / resubscribed | active |
| DID_RENEW (— / BILLING_RECOVERY) | renewed / billing_recovered | active, new expiry |
| DID_CHANGE_RENEWAL_STATUS (AUTO_RENEW_DISABLED / ENABLED) | auto_renew_disabled (= cancelled) / auto_renew_enabled | auto-renew; access continues to expiry |
| DID_CHANGE_RENEWAL_PREF | renewal_preference_changed | product change (only one product exists; another product id is rejected) |
| DID_FAIL_TO_RENEW (GRACE_PERIOD / —) | grace_period / billing_retry | grace keeps access until it ends |
| GRACE_PERIOD_EXPIRED | grace_period_expired | billing retry, no access |
| EXPIRED (any subtype) | expired | no access |
| REFUND / REVOKE | refunded / revoked | no access |
| REFUND_REVERSED | refund_reversed | state restored from Apple's data |
| RENEWAL_EXTENDED / OFFER_REDEEMED | renewal_extended / offer_redeemed | new expiry / state |

Recorded as `ignored` (no effect on the current membership model): TEST, PRICE_INCREASE, PRICE_CHANGE,
REFUND_DECLINED, CONSUMPTION_REQUEST, RENEWAL_EXTENSION (summary), METADATA_UPDATE, MIGRATION,
EXTERNAL_PURCHASE_TOKEN, ONE_TIME_CHARGE, RESCIND_CONSENT, and any future type. Verified but failing Sombrey's
checks (other product, no token, forged inner transaction) → `rejected`; unknown account → `unmatched` (the
app's own submission records it). HTTP: 200 received · 400 not a valid signed notification · 413 too large ·
503 not configured / Apple unreachable (Apple retries).

## 9. App → server (iOS)
`ConvexMembershipServer` sends only `["signedTransaction": jws]` to `commerce/appStore:submitTransaction` and
maps the coarse answer to `MembershipServerResult` (`recorded`, `unchanged`, `notConfigured`,
`rejected(.otherAccount | .unverified)`, `retryLater`, `notSent`). `retryLater` leaves the StoreKit
transaction **unfinished** so Apple re-delivers it; everything else finishes it. Afterwards the manager reads
`serverMembership` from `myEntitlements` — `.member` only if the server says so; errors → `.unavailable`,
never membership. New calm errors: `otherAccount`, `serverUnavailable`. Launch, purchase, `Transaction.updates`
and restore all go through the same path; restore = `AppStore.sync()` → verified entitlement → server → read.
`CommerceBackend.available` is true only with a real product id (never the StoreKit testing id), so today's
builds make **no** commerce calls. Xcode-environment transactions are never sent (Apple didn't sign them).

## 10. Configuration (nothing committed)
| Setting | Where | Now |
|---|---|---|
| App Store product id | `config.ts` `products.membership.appStoreProductId` **and** iOS `SOMBREY_MEMBERSHIP_PRODUCT_ID` (identical) | null / empty |
| `APPLE_ALLOWED_ENVIRONMENTS` | Convex env | unset |
| `APPLE_APP_APPLE_ID` | Convex env (required for Production) | unset |
| `APPLE_API_KEY_ID`, `APPLE_API_ISSUER_ID`, `APPLE_API_PRIVATE_KEY` (.p8, **secret**) | Convex env | unset |
| `COMMERCE_SANDBOX_GRANTS_ACCESS` | Convex env (dev/TestFlight decision) | unset = never |
| Apple Root CA - G3 | `appStoreConfig.ts` (public certificate, fingerprint-tested) | pinned |
**Order matters:** deploy the 6C backend to the deployment the app uses → set the Convex env → set the
product id in `config.ts` (new config version) and deploy → only then put the same id in the iOS build.

## 11. Production safety (this phase)
No deployment. No Convex environment variables set. No App Store Connect changes. No TestFlight upload. Not
merged. Production data untouched. The iOS app points at the production Convex deployment, which does not
have the commerce functions — hence the build-time gate in §9. Note: `npx convex codegen` (run locally to
regenerate the gitignored `convex/_generated` types) uploads the code to the configured **dev** deployment
for analysis; a read-only check afterwards confirmed the dev deployment's running functions are unchanged
(no `commerce/access|internal|appStore` functions exist there).
Testing needs a Convex deployment that runs this branch. Deploying it to the shared dev deployment
(`adamant-…`, used for Body Scan) would **replace** that deployment's functions, so it wasn't done: a separate
dev deployment (or a Convex preview deployment) is the safe option — decision pending.

## 12. App Store Connect — required later (nothing created)
- Paid Applications agreement, tax and banking.
- Subscription group (e.g. "Sombrey Membership"); one auto-renewable subscription: **permanent product id**
  (chosen once, never reused or changed), 1 month, **$30 USD**, **no free trial, no introductory offer**,
  localisations, review screenshot/notes. Family Sharing **off** (shared purchases are rejected by design).
- App Store Server API key (Users and Access → Integrations → In-App Purchase): key id, issuer id, .p8 →
  Convex env only.
- App's Apple ID (App Information) → `APPLE_APP_APPLE_ID`.
- App Store Server Notifications **V2**: Production URL and Sandbox URL →
  `<convex-site-url>/apple/app-store-notifications` of the respective deployments. Then "Request a Test
  Notification" → recorded as `TEST / ignored`.
- Sandbox testers for device testing.

## 13. Tests
`pnpm test:commerce` — 72 tests (6A/6B + 44 new):
- verification (15): token vector/determinism/namespace parity with Swift, configuration and pinned root,
  valid transaction, wrong bundle/product/environment/type/family sharing, invalid signatures (untrusted
  chain, tampered, `alg: none`, no x5c, leaf without Apple's OID, borrowed Apple chain), malformed, missing
  and wrong account token, expired/refunded/revoked/grace/retry, Apple unreachable/unknown/not configured,
  the notification lifecycle, informational/unknown types, forged and malformed notifications;
- recording (15): same transaction twice, same notification twice, app↔notification in both orders,
  concurrent repeats, late/out-of-order data, ownership, reinstall/second device, same Apple ID with another
  account, token matching, submission budget, purchase→renewal→cancellation→expiry, grace→retry→recovery,
  refund/revoke/reversal, append-only history, sandbox access flag;
- security (14): each attack in the brief attempted and refused, plus "no client-controlled value reaches the
  record" (every genuinely-signed variant of the app's JWS yields the identical, Apple-derived update).
Real cryptography: Apple's own `SignedDataVerifier`, with a throwaway P-256 chain generated by openssl at test
time (no private key committed). Swift: `MembershipTests` gains 5 tests; the pure core was compiled and a
36-check harness run locally (Swift 5.7), including that Swift and the server derive the same token.

## 14. Limitations / decisions pending
- Status for app submissions requires App Store Server API credentials (otherwise `not_configured`).
- Purchases without an `appAccountToken` (offer codes redeemed in the App Store, purchases outside the app)
  can't be linked — needs a decision (e.g. Apple's "Set App Account Token" API after sign-in).
- `COMMERCE_SANDBOX_GRANTS_ACCESS`: should TestFlight/App Review (sandbox) purchases grant access on
  production? App Review tests in sandbox against the production backend.
- A dev deployment for end-to-end testing (§11).
- Web Crypto SHA-1 in the Convex V8 runtime (used by `linkAppStoreAccount`) should be confirmed on first
  deployment; the Node action path is unaffected.
