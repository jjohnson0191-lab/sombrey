// SombreyWearablePlugin.swift
//
// NATIVE PLUGIN SKELETON — establishes the boundary, does not implement
// QCBANDSDK. Every method currently rejects with "not implemented" so
// the contract is real and testable end-to-end (React -> plugin ->
// Swift -> rejection) before any actual Bluetooth code exists.
//
// This file is NOT yet a member of an Xcode target. `npx cap add ios`
// (run separately, see the Phase 3 report for its actual outcome in this
// environment) generates ios/App/App.xcodeproj; adding this file to that
// project's target — and its bridging header/plugin registration — is a
// manual Xcode step for whoever has Xcode open, not something reliably
// scriptable from a CLI without risking a corrupted project file. This
// is intentionally left as a documented next step rather than a claimed
// "done."
//
// When implementing QCBANDSDK for real, this file (and only this file,
// plus a Swift QCBANDSDK wrapper it calls) is allowed to import
// QCBANDSDK — matching the approved architecture:
//   React/TypeScript -> SombreyWearableService -> Capacitor plugin (this)
//   -> Swift -> QCBANDSDK -> Sombrey Band

import Capacitor
import Foundation

@objc(SombreyWearablePlugin)
public class SombreyWearablePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SombreyWearablePlugin"
    public let jsName = "SombreyWearable"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "scanForDevices", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pairDevice", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unpairDevice", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getDeviceStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sync", returnType: CAPPluginReturnPromise),
    ]

    private func notImplemented(_ call: CAPPluginCall) {
        call.reject("Not implemented — QCBANDSDK integration is a later phase.")
    }

    @objc func scanForDevices(_ call: CAPPluginCall) { notImplemented(call) }
    @objc func pairDevice(_ call: CAPPluginCall) { notImplemented(call) }
    @objc func unpairDevice(_ call: CAPPluginCall) { notImplemented(call) }
    @objc func getDeviceStatus(_ call: CAPPluginCall) { notImplemented(call) }
    @objc func sync(_ call: CAPPluginCall) { notImplemented(call) }
}
