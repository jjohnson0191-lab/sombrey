# @sombrey/wearable

The TypeScript/domain boundary for the Sombrey wearable system.

## What this package IS

- Domain types for devices, device status, wearable measurements, sleep
  sessions, workout sessions, and sync results.
- The `SombreyWearableService` interface — the one thing React is
  allowed to depend on for wearable functionality.

## What this package is NOT

- **No Swift code.**
- **No QCBANDSDK imports.**
- **No Capacitor plugin implementation.**
- **No Bluetooth logic.**

Those all belong to a native plugin package (or `apps/mobile/ios`),
built in the wearable-integration phase once the actual QCBANDSDK is
supplied by the vendor. This package only exists so React code and the
eventual native plugin agree on a shape ahead of time — it is the
contract, not the implementation.

## Architecture this package supports

```
React / TypeScript
      -> SombreyWearableService   (this package)
      -> Capacitor native plugin  (later phase)
      -> Swift                    (later phase)
      -> QCBANDSDK                (later phase, vendor-supplied)
      -> Sombrey Band
```

## On the exact field shapes

Types here (`WearableMeasurement`, `SleepSessionData`, etc.) are
intentionally generic and will very likely be revised once QCBANDSDK's
real payloads are known. Nothing here should be read as a final schema.
