# Sombrey Commerce — Phase 6D (access, entitlements & feature gating)

Connects the 6A entitlement architecture to the app. **Server-authoritative**: the backend derives what
each account may access; the app only renders the answer. No checkout, no website, nothing deployed,
nothing purchasable. Body Scan, Readiness/Strain/Vitals calculations, wearable logic and the 6C Apple
verification are unchanged.

> **PROVISIONAL — SUBJECT TO CHANGE.** Band $100 · Membership $30/month, no trial · Band without
> membership and membership without Band both allowed · Band owner gets Vitals but not AI · member without
> Band gets the AI that needs no hardware · both = the full supported experience. All of it lives in
> `convex/commerce/config.ts` (version `2026-10-provisional.2`) — change a value there, not in the app.

## 1. How a decision is made
```
bandOwnership (orders; audited staff/legacy grants) ─┐
commerceSubscriptions (6C, Apple-verified)          ─┼─► entitlements.ts computeEntitlements
hasPremiumAccess(user) (legacy, see §8)             ─┘        │ state → capabilities (capabilityMatrix)
                                                              │ → features (featureMatrix) + unlockedBy
                                                              │ → membership summary · offers
                          commerce/gate.ts entitlementsFor ◄──┘
                           ├─ commerce/access:myEntitlements  (app reads it; reactive)
                           ├─ assertFeature (queries/mutations)  ┐ FEATURE_LOCKED
                           └─ requireFeature (actions)           ┘ enforced on the server
```
Nothing on the device is a source of truth: the answer lives in memory for the session only (no
UserDefaults, no disk). Reinstall, a new iPhone or another device simply ask again.

## 2. States
| State | Band | Membership | Capabilities |
|---|---|---|---|
| A `none` | – | – | — |
| B `band_owner` | ✓ | – | band_experience, vitals |
| C `subscriber` | – | ✓ | ai_intelligence, advanced_features |
| D `band_owner_subscriber` | ✓ | ✓ | all four |
**Band ownership** = an owned `bandOwnership` record: from an order (6E), or an audited
`internal.commerce.internal.grantBandOwnership` (`staff_grant` / `legacy_pairing`). A Bluetooth pairing
alone is **not** ownership (`pairedDeviceCountsAsBandOwnership: false` — any client can register a device).
**Membership** = a verified App Store record that grants access now (active, or in Apple's grace period
until it ends; sandbox only where `COMMERCE_SANDBOX_GRANTS_ACCESS=true`), or legacy premium (§8).

## 3. Feature matrix (`config.ts featureMatrix`)
| Feature id | Requires | Unlocked by | App surface |
|---|---|---|---|
| account | — | — | sign-in, profile, deletion |
| settings | — | — | settings, notifications, schedules |
| band_pairing | — | — | pairing (Settings › Band) — never proof of ownership |
| core_tracking | — | — | training, workouts, exercise library, food search & logging, progress, goals |
| body_scan | — | — | Body Scan — unchanged, its own consent/ownership/privacy rules |
| vitals | vitals | Band | Home live heart rate + Today's Vitals, Vitals screen (Home, Progress) |
| wearable_data | band_experience | Band | Home Readiness, Strain, activity dial, sleep |
| ai_coach | ai_intelligence | Membership | Sombrey tab › Coach (server-enforced) |
| ai_meal_analysis | ai_intelligence | Membership | AI Macro Calculator (server-enforced) |
| advanced_intelligence | advanced_features | Membership | reserved — no surface exists; gates nothing |
`validateCommerceConfig` rejects unknown capabilities, a paid feature no state can unlock, and any gate on
account/settings/pairing. The app's `FeatureID` enum is tested against this list.

## 4. Behaviour per state
- **A** — the free core works normally. Home shows one card (BAND REQUIRED) where the Band instruments
  were; the Coach and the Macro Calculator show MEMBERSHIP REQUIRED. Each card opens the access sheet: what
  Sombrey is, what the Band and Membership each unlock (from the server's matrix via `publicConfig`),
  prices from the server config (Apple's price for Membership once the product loads), status, Restore.
- **B (Band only)** — the Band experience: pairing, Vitals, Readiness/Strain, sleep, activity, all history.
  AI stays locked, intentionally ("Sombrey Coach is part of Membership").
- **C (Membership only)** — Coach and Macro Calculator. No Band-derived data is shown or invented.
- **D** — everything that exists.

## 5. Changes over time
All transitions come from 6C's verified records, so the app just re-renders (the query is reactive):
- cancel (auto-renew off) → still a member until the period ends ("Active · ends 31 Oct"), then expired;
- expiry / billing retry / revocation / refund → AI locks; **Band access, ownership and all data stay**;
- grace period → still a member until Apple's grace ends;
- renewal / refund reversal / resubscribe → AI unlocks again.
An `active` record past its expiry counts as expired even before Apple's notification. Nothing in the
commerce layer deletes data (tested). Time passing alone doesn't re-run a Convex query; the app refreshes
on returning to the foreground, and Apple's EXPIRED notification changes the data.

## 6. Restore / reinstall / new device
Entitlements are computed from the account's server records only — no device id, no local state. Restore
Purchases (access sheet) runs the 6C path (AppStore.sync → server verification) and refreshes.

## 7. Security (tests/commerce/access.test.ts, security.test.ts, EntitlementTests.swift)
Refused: a pairing claiming ownership; a client granting AI (the Coach action and the Macro Calculator
upload/analysis check entitlements on the server — `FEATURE_LOCKED`); any client write to ownership,
subscriptions or orders (no public mutation exists); a fake/malformed entitlement response (the app fails
closed — unknown fields, a missing feature or an unknown unlock → "couldn't check", never access); offline
→ never access; client-recorded server events. `myEntitlements` takes no arguments; `requireFeature` takes
only the feature id — the user always comes from the auth identity.
Deliberately **not** server-blocked: the user's own Band readings (reads and uploads of wearable data).
They're the user's data, only exist if a Band recorded them, and uploads must never be dropped (data kept
through a lapse). Their display is gated by the server's answer. Decision pending if you want hard blocks.

## 8. Legacy access (unchanged)
`hasPremiumAccess(user)` = staff roles (coach/admin/owner/assistant), `adminGrantedPremium`, and tiers
premium / coaching_client / self_guided / semi_guided / full_guided (GOAT WALK web Premium via Hercules;
offline payments set tiers through the existing owner flow). With `legacyAccessGrantsSubscriberCapabilities:
true` these count as **membership** (source `legacy_premium`) — never as a Band, never converted into App
Store records. The legacy web AI gate (`getFitnessContext`) is untouched.
Conflict to decide: after 6D is deployed, the native Sombrey Coach — previously open to every signed-in
user — needs membership or legacy premium. Testers without either need `adminGrantedPremium` or a
subscription.

## 9. Band ownership for existing Bands
Bands paired before commerce (including test Bands) are no longer ownership on their own. After verifying a
Band is genuinely the user's, staff run (dashboard/CLI, never the app):
`internal.commerce.internal.grantBandOwnership { userId, source: "legacy_pairing" }` — idempotent, audited
in the record's history; `revokeBandOwnership { ownershipId }` ends it (history kept).

## 10. Analytics
New client event `feature_access_denied` (source = feature id; once per feature per session; no PII, no
amounts). Existing: `subscription_purchase_initiated` (StoreKit path). No Band purchase event is recorded —
there is no Band checkout yet. Server-only events stay server-only.

## 11. Rollout switch
iOS: Info.plist `SombreyCommerceEntitlements` ← build setting `SOMBREY_COMMERCE_ENTITLEMENTS`. Empty (all
builds today) → **not enforced**: the app behaves exactly as before 6D and calls no commerce function.
Set it to `enabled` only for a build whose Convex deployment runs this backend. Backend enforcement is
active wherever this backend is deployed.

## 12. Files
Backend: `convex/commerce/gate.ts` (new), `config.ts` (feature matrix, pairing rule, v.2),
`entitlements.ts` (features, unlocks, membership summary, offers), `access.ts` (myEntitlements via gate,
publicConfig + featureUnlocks), `internal.ts` (grant/revoke Band ownership), `events.ts` + `validators.ts`
(`feature_access_denied`), `ownership.ts` (comment), `ai/sombreyCoach.ts`, `mealPhotos.ts` (enforcement).
iOS: `Commerce/EntitlementModels.swift`, `EntitlementStore.swift`, `AccessViews.swift` (new);
`SombreyApp.swift`, `HomeScreen.swift`, `AICoachScreen.swift`, `NutritionScreen.swift`, `ProgressScreen.swift`,
`SettingsScreen.swift`, `Info.plist`, `project.pbxproj`; `SombreyAppTests/EntitlementTests.swift`.
Tests: `tests/commerce/access.test.ts` (18), updates to `entitlements.test.ts`, `security.test.ts`.
Also on this branch: the launch-crash fix (`NotificationManager.fetchOnce`, from hotfix/launch-crash).

## 13. For 6E and later
Band checkout (provider, Apple Pay/Google Pay/card, shipping to the six countries, customer-paid tax and
shipping), order → ownership records, order tracking, returns (30 days, unused), activation (6G), the
website, and the App Store product itself (6C §12).
