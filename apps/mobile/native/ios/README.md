# Native iOS plugin sources (not yet part of an Xcode target)

`SombreyWearablePlugin.swift` is a skeleton implementation of the
`SombreyWearable` Capacitor plugin (see
`../../src/features/wearable/plugin/definitions.ts` for the contract).
Every method currently rejects with "not implemented."

## Why this isn't wired into `ios/` yet

`npx cap add ios` generates the Xcode project. Adding a Swift file to an
Xcode target's "Compile Sources" build phase and to the plugin registry
is normally done in Xcode itself (drag-and-drop, or edited via the
`.pbxproj` file, which is fragile to hand-edit outside Xcode's own
tooling). Rather than risk a corrupted project file by hand-patching
`project.pbxproj` from a script, this plugin's source lives here,
ready to be added, with the integration step documented rather than
silently skipped.

## To wire it in (once `ios/` exists)

1. Open `ios/App/App.xcworkspace` in Xcode.
2. Add `SombreyWearablePlugin.swift` (and a bridging header if Xcode
   prompts for one) to the `App` target.
3. Run `npx cap sync ios` again so Capacitor's plugin registry picks it
   up.
4. Confirm `SombreyWearable.scanForDevices()` (called from
   `src/features/wearable/SombreyWearableService.ts`) rejects with
   "Not implemented" on a real device build — that's the expected,
   correct behavior until QCBANDSDK is actually integrated.
