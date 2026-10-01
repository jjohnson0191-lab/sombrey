# Sombrey Commerce — Phase 6H (Membership & commerce UX)

The customer-facing side of 6A–6G inside the existing app. A **presentation layer**: every value comes
from the server (or, for the membership price, from Apple); when the server can't answer, the screen says
so. No new tab, no checkout form, no fake data. Nothing deployed.

## 1. Where it lives
**Settings › Account** — the existing home of account and Band management. When this build's backend
serves entitlements (`SOMBREY_COMMERCE_ENTITLEMENTS=enabled`, 6D), three quiet rows replace 6D's single
"Membership & Band" row:
- **Membership** (detail: Active / Not a member, from the server) → `MembershipView`
- **Sombrey Band** (detail: On your account / None) → `BandView` → `ActivationView`
- **Orders** → `OrdersView` → `OrderDetailView`
Builds without it keep the previous "Subscription — Not available yet" row. Locked-feature cards (6D) now
open the product that unlocks them (Membership or Band; both → the overview sheet); the Nutrition AI
Macro Calculator entry opens Membership. Sheets follow the app's pattern (NavigationStack, inline title,
Done; `env4` background; Sombrey glass chambers; Studio type; existing CTA styles).

## 2. Implemented
**Membership** — what it is (separate from the Band); the server's status in plain words (Active · renews
/ Active · ends {date} when cancelled — "you keep Membership until then" / grace / paused / Ended / Ended by
Apple / included with your account); what it includes (from the server's feature matrix); the price
(Apple's localized price once the product loads, else the server's); **Join** only when the server says it's
purchasable and Apple returned the product (StoreKit 2 via `MembershipManager` — verified transactions, server
verification, no client flag); **Restore purchases** (existing StoreKit restore; restored / nothing to restore
/ unavailable / couldn't verify — a restore isn't membership until the server confirms it); **Manage in Apple
ID settings** (`manageSubscriptionsSheet`) for App Store memberships. Expiry locks AI on the server; the
screen says the Band and its data stay.

**Sombrey Band** — "Sombrey Band V1" from the server's name + generation; **My Band** from the server:
ownership = `myEntitlements.ownsBand` (a pairing never counts); devices from `myDevices` (Active / Replaced /
Returned / No longer active, paired or not, the server's redacted identifier only when there are several;
a staff-granted Band with no device record reads "Sombrey Band · on your account"); **Activate a Band**;
"Pair or reconnect your Band in Settings › Band" (the existing, unchanged pairing UI). **The Band** product:
the server's price ("Price unavailable" otherwise), what it unlocks, the membership relationship, and the
checkout state — today "Band checkout isn't open in the app yet." (server `checkoutAvailable: false`). Even
if the server opens checkout, this version says checkout isn't available in this version yet: there is no
address/payment UI and nothing is charged.

**Activation** — code entry (monospaced, characters, no autocorrect, one-time-code content type) → the
server (`commerce/myDevices:activateDevice`). Success only when the server says `activated` /
`already_active`; every refusal reads calmly (wrong code, too many attempts, not delivered yet, another
account, …); network failure → "Activation unavailable." **No Bluetooth is touched.** Next step: pair in
Settings › Band.

**Orders** — your orders (server: `myOrders`, owner-only): items × quantity, date, order number, status in
customer words (Order confirmed, Preparing, Shipped, Delivered, Delivery problem, Return requested/approved/
on its way/received, Refunded, Checkout not finished, Payment pending, Cancelled; unknown → "Status
unavailable"). **Order detail** (`orderTracking`, `returnOptions`, owner-only): status, total (when known),
progress steps lit only from real provider state, **tracking** only when the carrier supplied carrier +
number (https link and the carrier's own ETA only if given) — otherwise "Tracking information unavailable";
returns (the return's status; "Return available until {date} — unused Bands only" / window closed). No
animation, no fake journey. Hidden: provider ids, fulfilment ids, device identifiers, staff notes.

**Entitlement states** — unchanged (6D matrix): A free core; B Band experience; C Coach + Macro
Calculator, no invented Band data; D everything. Locked surfaces say BAND REQUIRED / MEMBERSHIP REQUIRED /
BAND + MEMBERSHIP REQUIRED in the existing glass card, with one calm "About…" action. No paywall.

**Loading / errors** — loading states while the server resolves; "Membership status unavailable", "Band
status unavailable", "Order status unavailable", "Checkout unavailable", "Activation unavailable" with
"Try again" where useful. Nothing stale is presented as current; nothing is assumed.

**Analytics** (client events, existing pipeline; product id + short labels only): `product_viewed`
(membership_screen / band_screen), `restore_purchases_started`, `order_viewed`, `tracking_viewed`,
`device_activation_started`; the existing `subscription_purchase_initiated` (MembershipManager) and
`feature_access_denied`. No address, payment, MAC, serial, code or device id; revenue events stay server-only.

**Accessibility** — 44 pt targets (rows, links, retry), headers marked, rows combined for VoiceOver,
progress steps announce Done / Not yet, decorative glyphs hidden, StudioFont text, no custom animation
(Reduce Motion unaffected).

**Backend changes (small)** — four client events; `publicConfig.band.generation`; `visibleToCustomer`
(the one owner gate for order detail/tracking).

## 3. Deferred (pending provider / hardware decisions)
- **Band checkout UI** (address, quote, payment) — needs the payment/shipping/tax providers (6E/6F).
- **Return request UI** — backend exists (6F); not exposed yet (decision: self-serve vs. support-led).
- **Pairing link** — reading the Band's MAC after pairing and calling `linkPairing` (6G) changes the
  working BLE command sequence; needs hardware validation. "Paired" therefore reads "Not paired with this
  iPhone yet" until then.
- **Turning it on** — all of this appears only in a build with `SOMBREY_COMMERCE_ENTITLEMENTS=enabled`
  against a deployment running the 6A–6H backend; membership purchase also needs the App Store product id.

## 4. Tests
- Swift: `SombreyAppTests/CommerceModelsTests.swift` (10) + `EntitlementTests.swift` — run locally through a
  harness against the pure models (148 checks); compiled with the app by the Codemagic compile check.
- Node: `tests/commerce/commerceUx.test.ts` (7) — owner-only orders, public config, events, and source
  checks on the Swift layer (no local unlock flags, Band never via StoreKit, no price literals, server-driven
  checkout, tracking only when real, no Bluetooth in commerce screens, placement in Settings).
- Deliberately broken and caught: client-side membership unlock, client-side Band unlock (pairing counted),
  unauthorized order display.
