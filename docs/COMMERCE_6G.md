# Sombrey Commerce — Phase 6G (Band ownership, activation & physical device identity)

Connects a real physical Band to an order line and an account — by **activation**, never by payment,
delivery, Bluetooth discovery or pairing. Backend only: nothing deployed, no Swift changes, no
hardware validated, no firmware touched, no Bluetooth rename.

```
ORDER → FULFILMENT → SHIPMENT → DELIVERY → PHYSICAL DEVICE → ACTIVATION → OWNERSHIP → PAIRING → BAND FEATURES
  6E        6F          6F         6F      commerceDevices   activation   bandOwnership  wearableDevices  6D entitlements
```

## 1. Audit — what exists (evidence)
| Identity | Source | Status | Suitable as… |
|---|---|---|---|
| BLE name `G69` | firmware advertisement / `CBPeripheral.name` | in use (display only) | nothing — not an identity |
| `CBPeripheral.identifier` | iOS, **per iPhone**, resets with Bluetooth/OS resets | `wearableDevices.deviceId`, reconnection (`retrievePeripherals`), restoration, Sport+ `deviceId` | a per-phone **connection** id only |
| **MAC address** | QCBandSDK `getDeviceMacAddressSuccess:` (after connecting, "AA:BB:CC:DD:EE:FF"); vendor demo also reads it from advertised manufacturer data | **available, not used by the app today** | the stable **identifier** (vendor must confirm it's a unique public static address) — **not proof of possession** (anyone nearby can read it) |
| Serial number | — | **no SDK API** (headers, binary, guide) | — |
| Hardware/firmware version | `getDeviceSoftAndHardVersionSuccess:` | available (`firmwareInfo`, unused) | hardware revision |
| `getUUID`/`setUUID` | SDK, "device identifier < 10 characters, certain devices only" | semantics undocumented | **not used** (also not a rename mechanism) |
Nothing in the repo previously linked a pairing, an order and a physical unit.

## 2. Implemented now
**Physical device** — `commerceDevices`: product, generation, hardware revision, identifier kind
(`mac`|`serial`|`vendor_id`, per product: `config.products.band.identityKinds = ["mac"]`), canonical
identifier (unique), status, SHA-256 of its one-time activation code, order, fulfilment (= order line),
device it replaces, owner + current ownership, activated/ended times, who registered it, full history.
Lifecycle: `registered → assigned → activated → replaced | returned | deactivated → retired`
(`assigned → registered` to unassign). Never deleted.

**Ownership** — `bandOwnership` (6A table) evolved: `source: "activation"`, `deviceId`, `productId`,
statuses `activated → replaced | returned | deactivated` (history appended with actor and reason, never
rewritten). Zero, one or many devices per account. Not the order; not the pairing.

**Activation** — the customer types the code packed with the unit (`myDevices.activateDevice`). The
server hashes it, finds the unit, and checks (`devices.activationEligibility`): unit assigned to a
fulfilment; product requires activation; the order is **this account's**, paid (or partially refunded),
not cancelled; the fulfilment delivered by the carrier (`config.devices.activationRequiresDelivery`) and
not cancelled/failed; unit not already activated. Then: ownership row + unit `activated` + event.
Idempotent (same account again → the same ownership; concurrent retries → one). Failed attempts are
recorded; 10 per account per hour. Never from the client: no owner, order, device id or eligibility is
accepted. If the server can't verify, it refuses — there's no local fallback.

**Why a code:** the MAC identifies a unit but anyone near it can read it; the code proves possession of
the box. Codes: 12 Crockford-base32 characters (60 bits), generated from cryptographic randomness in an
action (mutation randomness is deterministic), shown once to staff for printing, stored only as SHA-256,
retired on use/return/retirement, reissuable (owner/admin) before activation.

**Order-line mapping** — staff assign registered units to a fulfilment (`assignDevice`); a fulfilment
takes at most its line quantity per product; nothing is assigned automatically because two Bands were
bought. Units carry `orderId` + `fulfillmentId`.

**Replacement** — a replacement fulfilment's unit must name the unit it replaces (same order, from the
fulfilment it replaces). Activating it ends the old ownership as `replaced` and the old unit as
`replaced`; one active Band; both histories kept; the old record is never deleted.

**Returns/refunds** — a return request never ends ownership. Staff name the units received
(`staff.receiveReturn(deviceIds)`, checked against the order and the return's quantities); ownership ends
as `returned` at receipt (`config.devices.ownershipEndsOnReturnAt: "received"`, default) or when the
refund is verified (`"refunded"`). The unit becomes `returned` and its code dies.

**Pairing link** — `myDevices.linkPairing({peripheralId, hardwareIdKind, hardwareId})`: links the user's
existing pairing (`wearableDevices` row for that CBPeripheral id) to a physical unit **only if that same
user already owns it** (`physicalDeviceId`, `linkedAt` on `wearableDevices`). Other account's unit →
`owned_by_another_account`; unregistered (e.g. test/legacy Bands) → `not_registered`; not activated →
`not_activated`. Linking never creates, moves or extends ownership, and a pairing alone never counts as a
Band. Reconnects and new phones change nothing.

**Entitlements (6D)** — "owns a Band" now includes an **active** `activation` ownership of a Band product
(`isBandProduct`), alongside the existing audited staff/legacy grants. The four states are unchanged;
pairing, payment, shipping and delivery grant nothing. Deactivation, replacement and returns remove it.

**Staff** (`staffDevices.ts`, roles via `staffAccess.ts`):
| Operation | owner | admin | store_manager |
|---|---|---|---|
| register unit (get code), assign / unassign, list devices (redacted ids) | ✓ | ✓ | ✓ |
| receive returned units (6F return flow) | ✓ | ✓ | ✓ |
| reissue code, activate at in-person handover, deactivate, retire, inspect full identity | ✓ | ✓ | — |
Handover activation still requires the customer's own paid order. Every change is in the unit's and the
ownership's history.

**Account deletion** — units the account activated are deactivated (`account_deleted`) before its
ownership rows are purged (existing 6A rule); activation attempts removed; unit records and history kept.

**Analytics** (server, product + reason only): `device_activation_completed`, `device_activation_failed`,
`device_paired` (link), `device_replaced`, `device_deactivated`, `device_returned`. Never a MAC, serial,
device id, code, address or payment data (tested). "Unpaired" isn't recorded: unpairing is device-local.

**Privacy** — full identifiers only in `commerceDevices` and owner/admin `inspectDevice`; store managers
and customers see `…A1B2`; codes never stored or logged; no `console.*` in device code.

## 3. Requires vendor / hardware / app work (not done)
1. **App wiring (decision):** read the connected Band's MAC (`getDeviceMacAddressSuccess:`) after pairing
   and call `linkPairing`; an activation screen calling `activateDevice`. Deferred: it adds a command to the
   working BLE command sequence and needs hardware testing.
2. **Vendor confirmation (SWL Technology):** that the MAC is a unique, factory-assigned public static
   address (not random/rotating); whether a factory serial exists and how to read it; what
   `getUUID`/`setUUID` store.
3. **Stronger proof (optional, vendor):** a per-device secret or challenge–response in firmware would let
   the app prove possession over BLE without a printed code.
4. **Operations:** printing codes and packing them with units; a registration step at the warehouse.
5. **Carrier delivery:** with no logistics provider, nothing is carrier-delivered, so customers can't
   self-activate yet; staff handover activation works.

## 4. Bluetooth name (documented only)
The advertised name `G69` comes from firmware; the SDK has no rename command; `setUUID`/`endBroadcast` are
not rename mechanisms and aren't used. Intended: app product name **Sombrey Band V1**; advertised name
**Sombrey Band** via vendor firmware/OTA. The BLE name is never an identity or an ownership key.
Request to SWL Technology: firmware (and OTA) with advertised Complete Local Name `Sombrey Band` and GATT
Device Name `Sombrey Band V1` (or max lengths), confirming nothing else changes (service UUIDs,
manufacturer data incl. MAC, bonding, protocols) — see the Bluetooth audit.

## 5. Future hardware
Units reference `productId`, `generation`, `hardwareRevision`; which identifiers a product has is config
(`identityKinds`); activation and Band entitlement are per product (`requiresActivation`, category
`physical_band`). A V2/Pro/Lite is a config entry with its own identifier kinds — ownership is unchanged.
No device code names a product or a Bluetooth name (tested).

## 6. Tests
`tests/commerce/devices.test.ts` (19) + integration with 6D/6F; deliberately broken and caught:
cross-account activation, pairing-to-ownership separation (two ways), duplicate-activation protection.
