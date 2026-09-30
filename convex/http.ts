/**
 * Convex HTTP Actions router.
 * V8 runtime — do NOT add "use node" to this file.
 *
 * Routes:
 *   POST /mailgun-inbound  — Mailgun inbound email webhook
 *   POST /apple/app-store-notifications — App Store Server Notifications V2 (Phase 6C)
 */

import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

/**
 * Mailgun inbound email webhook.
 *
 * Mailgun sends a multipart/form-data POST when an email arrives at
 * admin@agoatwalk.com. We verify the HMAC signature, parse the fields,
 * and store the email via storeInbound.
 *
 * Setup in Mailgun Dashboard:
 *   Receiving → Routes → Create Route
 *   Expression: match_recipient("admin@agoatwalk.com")
 *   Action: forward("<your-convex-site-url>/mailgun-inbound")
 *   Priority: 0
 */
http.route({
  path: "/mailgun-inbound",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    // Parse multipart form — Mailgun sends form-data
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return new Response("Bad request", { status: 400 });
    }

    // ── Signature verification ────────────────────────────────────────────────
    // Mailgun signs every inbound webhook with HMAC-SHA256.
    // Signing key is available as MAILGUN_WEBHOOK_SIGNING_KEY secret.
    const signingKey = process.env.MAILGUN_WEBHOOK_SIGNING_KEY;
    if (signingKey) {
      const timestamp = formData.get("timestamp") as string | null;
      const token = formData.get("token") as string | null;
      const signature = formData.get("signature") as string | null;

      if (!timestamp || !token || !signature) {
        return new Response("Missing signature fields", { status: 403 });
      }

      // HMAC-SHA256 of (timestamp + token)
      const encoder = new TextEncoder();
      const keyData = encoder.encode(signingKey);
      const msgData = encoder.encode(timestamp + token);

      const cryptoKey = await crypto.subtle.importKey(
        "raw",
        keyData,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const signatureBytes = await crypto.subtle.sign("HMAC", cryptoKey, msgData);
      const computed = Array.from(new Uint8Array(signatureBytes))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      if (computed !== signature) {
        console.warn("[mailgun-inbound] Invalid signature — rejecting");
        return new Response("Forbidden", { status: 403 });
      }
    } else {
      console.warn("[mailgun-inbound] MAILGUN_WEBHOOK_SIGNING_KEY not set — skipping signature check");
    }

    // ── Parse fields ──────────────────────────────────────────────────────────
    const from = (formData.get("from") as string | null) ?? "";
    const recipient = (formData.get("recipient") as string | null) ?? "";
    const subject = (formData.get("subject") as string | null) ?? "(no subject)";
    const bodyPlain = (formData.get("body-plain") as string | null) ?? "";
    const messageId = (formData.get("Message-Id") as string | null) ??
      (formData.get("message-id") as string | null) ??
      `mailgun_${Date.now()}`;

    // Parse "Display Name <email@example.com>" format
    const fromMatch = from.match(/^(.*?)\s*<(.+?)>$/) ?? null;
    const fromName = fromMatch ? fromMatch[1].trim() : from;
    const fromAddress = fromMatch ? fromMatch[2].trim() : from;

    const receivedAt = new Date().toISOString();

    try {
      await ctx.runMutation(internal.businessEmails.storeInbound, {
        fromAddress,
        fromName,
        toAddresses: [recipient || "admin@agoatwalk.com"],
        subject,
        body: bodyPlain,
        mailgunMessageId: messageId,
        receivedAt,
      });
    } catch (err) {
      console.error("[mailgun-inbound] storeInbound failed:", err);
      // Return 200 to prevent Mailgun from retrying a permanent failure
    }

    return new Response("OK", { status: 200 });
  }),
});

// REQUIRED: must be the default export
/**
 * App Store Server Notifications V2 (Sombrey commerce, Phase 6C).
 *
 * Apple POSTs {"signedPayload": "<JWS>"}. Nothing in the request is trusted
 * until commerce/appStore:processNotification has verified Apple's signature
 * (x5c chain to Apple Root CA - G3, bundle id, environment, app Apple ID);
 * it then records the notification once by notificationUUID and applies it
 * through the backend-only subscription mutation. Anyone can reach this URL,
 * but only data signed by Apple for com.sombrey.app can change anything.
 *
 * App Store Connect → App → App Information → App Store Server Notifications:
 *   Version 2, URL <convex-site-url>/apple/app-store-notifications
 * (docs/COMMERCE_6C.md §9 — not configured yet).
 */
const MAX_NOTIFICATION_BYTES = 64 * 1024;
http.route({
  path: "/apple/app-store-notifications",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > MAX_NOTIFICATION_BYTES) return new Response("Payload too large", { status: 413 });
    const text = await request.text();
    if (text.length > MAX_NOTIFICATION_BYTES) return new Response("Payload too large", { status: 413 });
    let signedPayload: unknown;
    try {
      signedPayload = (JSON.parse(text) as { signedPayload?: unknown })?.signedPayload;
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    if (typeof signedPayload !== "string" || !signedPayload) return new Response("Bad request", { status: 400 });
    const r = await ctx.runAction(internal.commerce.appStore.processNotification, { signedPayload });
    return new Response(r.httpStatus === 200 ? "OK" : r.httpStatus === 503 ? "Try again later" : "Bad request", { status: r.httpStatus });
  }),
});

export default http;
