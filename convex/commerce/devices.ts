// Sombrey commerce — Phase 6G: physical devices, activation and identity (pure rules).
//
//   ORDER ≠ FULFILMENT ≠ SHIPMENT ≠ DELIVERY ≠ PHYSICAL DEVICE ≠ ACTIVATION ≠
//   OWNERSHIP ≠ PAIRING
//
// A PHYSICAL DEVICE (commerceDevices) is one real unit, identified by a hardware
// identifier the product actually exposes (config: identityKinds — the Band V1:
// its MAC). Never by its Bluetooth name ("G69", or a future "Sombrey Band"),
// never by the iPhone's CBPeripheral.identifier (per-phone, per-install), never
// by an order. Staff REGISTER a unit and ASSIGN it to a fulfilment (an order line
// of a specific order); the customer ACTIVATES it with the one-time code packed
// with it — possession of the box is the proof, since a MAC can be read by
// anyone nearby and so proves nothing on its own. Activation creates OWNERSHIP
// (bandOwnership, source "activation"); PAIRING (wearableDevices) can then be
// linked to a device its user owns — and grants nothing by itself.
//
// Pure — tested in tests/commerce/devices.test.ts.

import { physicalProduct, type CommerceConfig } from "./config.ts";
import type { PaymentStatus } from "./orders.ts";
import type { FulfillmentRecordStatus } from "./fulfillment.ts";

export type HardwareIdKind = "mac" | "serial" | "vendor_id";

/** A hardware identifier in canonical form, or null if it isn't one. */
export function normalizeHardwareId(kind: HardwareIdKind, raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (kind === "mac") {
    const hex = s.replace(/[:\-.\s]/g, "").toUpperCase();
    if (!/^[0-9A-F]{12}$/.test(hex) || /^0{12}$|^F{12}$/.test(hex)) return null;
    return hex.match(/../g)!.join(":");
  }
  if (kind === "serial") return /^[A-Za-z0-9-]{4,40}$/.test(s) ? s.toUpperCase() : null;
  return /^[A-Za-z0-9_-]{1,40}$/.test(s) ? s : null;
}

/** "…A1B2" — enough to tell a customer's devices apart, not to identify one. */
export function redactHardwareId(id: string): string {
  const compact = id.replace(/[:-]/g, "");
  return compact.length <= 4 ? "…" : `…${compact.slice(-4)}`;
}

// ─── Activation codes ────────────────────────────────────────────────────────
// 12 Crockford base32 symbols = 60 bits, shown as XXXX-XXXX-XXXX. Generated from
// cryptographic randomness in an ACTION (a mutation's randomness is
// deterministic); only its SHA-256 is stored. Typing is forgiving: case,
// spaces and dashes are ignored, O→0 and I/L→1.

/** Crockford base32: 32 symbols, so a random byte % 32 is unbiased. */
export const ACTIVATION_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function generateActivationCode(randomBytes: Uint8Array): string {
  if (randomBytes.length < 12) throw new Error("an activation code needs 12 random bytes");
  const chars = Array.from(randomBytes.slice(0, 12), (b) => ACTIVATION_ALPHABET[b % 32]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8, 12).join("")}`;
}

/** SHA-256 (hex) of a canonical code — the only form the server stores. */
export async function hashActivationCode(canonical: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`sombrey-activation:${canonical}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The canonical 12 characters a customer typed, or null. */
export function normalizeActivationCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  if (s.length !== 12) return null;
  for (const c of s) if (!ACTIVATION_ALPHABET.includes(c)) return null;
  return s;
}

// ─── Device lifecycle ────────────────────────────────────────────────────────

export const DEVICE_STATUSES = ["registered", "assigned", "activated", "replaced", "returned", "deactivated", "retired"] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];
export const DEVICE_TRANSITIONS: Record<DeviceStatus, DeviceStatus[]> = {
  registered: ["assigned", "retired"],
  assigned: ["registered", "activated", "returned", "retired"],
  activated: ["replaced", "returned", "deactivated"],
  replaced: ["returned", "retired"],   // 6I: the old unit can still be sent back
  returned: ["retired"],
  deactivated: ["retired"],
  retired: [],
};

export type ActivationRefusal =
  | "invalid_code" | "too_many_attempts" | "already_activated" | "not_activatable" | "not_eligible_for_account"
  | "not_paid" | "not_delivered" | "product_not_supported" | "activation_unavailable";

/** Server-side eligibility to activate a device for an account. Nothing here is
 * taken from the app: device, order and fulfilment come from the database. */
export function activationEligibility(input: {
  userId: string;
  device: { status: DeviceStatus; productId: string; ownerUserId?: string; orderId?: string };
  order: { userId: string; paymentStatus: PaymentStatus; cancelledAt?: number } | null;
  fulfillment: { status: FulfillmentRecordStatus; orderId: string } | null;
  /** Staff confirmed an in-person handover: delivery need not be carrier-confirmed. */
  handover?: boolean;
}, config: CommerceConfig): { ok: true; alreadyYours?: true } | { ok: false; reason: ActivationRefusal } {
  const { device, order, fulfillment } = input;
  if (device.status === "activated") {
    return device.ownerUserId === input.userId ? { ok: true, alreadyYours: true } : { ok: false, reason: "already_activated" };
  }
  if (device.status !== "assigned" || !device.orderId || !fulfillment) return { ok: false, reason: "not_activatable" };
  const product = physicalProduct(config, device.productId);
  if (!product?.requiresActivation) return { ok: false, reason: "product_not_supported" };
  if (!order || order.userId !== input.userId || fulfillment.orderId !== device.orderId) return { ok: false, reason: "not_eligible_for_account" };
  if ((order.paymentStatus !== "paid" && order.paymentStatus !== "partially_refunded") || order.cancelledAt !== undefined) return { ok: false, reason: "not_paid" };
  if (fulfillment.status === "cancelled" || fulfillment.status === "failed") return { ok: false, reason: "not_delivered" };
  if (config.devices.activationRequiresDelivery && !input.handover && fulfillment.status !== "delivered") return { ok: false, reason: "not_delivered" };
  return { ok: true };
}

/** Does an ownership record give Band features? Only an ACTIVE one, of a product
 * that is a Band. (Legacy staff/legacy-pairing grants carry no product.) */
export function isBandProduct(config: CommerceConfig, productId: string | undefined): boolean {
  return productId !== undefined && physicalProduct(config, productId)?.category === "physical_band";
}
