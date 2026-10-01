// Sombrey commerce, Phase 6I — structured, redacted operational logs.
//
// One JSON line per notable outcome (`[commerce] {"event":…}`) so failures can
// be counted and searched in the Convex dashboard. Values are scalars only and
// any field whose NAME suggests personal or secret data is dropped, whatever
// the caller passes: no activation codes, payment credentials, addresses,
// names, emails, hardware ids, Apple receipts or tokens. Ids of Sombrey's own
// records (order/fulfilment/shipment ids) and outcome/reason codes are fine.
// The durable audit trail stays in the event tables (commercePaymentEvents,
// commerceShipmentEvents, commerceEvents) — these logs are for operations.

type Scalar = string | number | boolean | null;

const SENSITIVE = /code|secret|token|receipt|signed|jws|card|pan|cvc|iban|address|line1|line2|postal|street|city|name|email|phone|mac|hardware|serial|password|credential/i;

export function redactLogFields(fields: Record<string, unknown>): Record<string, Scalar> {
  const out: Record<string, Scalar> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (SENSITIVE.test(k)) continue;
    if (v === null || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v))) out[k] = v;
    else if (typeof v === "string") out[k] = v.slice(0, 80);
  }
  return out;
}

export function logCommerce(event: string, fields: Record<string, unknown> = {}, level: "info" | "warn" = "info") {
  const line = `[commerce] ${JSON.stringify({ event, ...redactLogFields(fields) })}`;
  if (level === "warn") console.warn(line); else console.info(line);
}
