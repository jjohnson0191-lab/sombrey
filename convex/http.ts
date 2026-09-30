/**
 * Convex HTTP Actions router.
 * V8 runtime — do NOT add "use node" to this file.
 *
 * Routes:
 *   POST /mailgun-inbound  — Mailgun inbound email webhook
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

/** The caller's identity for the Body Scan endpoints, or null. A malformed or
 * forged token is a plain 401 — never a 500 that echoes the parser's error. */
async function bodyScanIdentity(ctx: { auth: { getUserIdentity: () => Promise<{ tokenIdentifier: string } | null> } }) {
  try {
    return await ctx.auth.getUserIdentity();
  } catch {
    return null;
  }
}

/**
 * Body Scan images — the ONLY way a body-scan image leaves storage.
 *
 *   GET /body-scan-image?scanId=<uuid>&view=front|side|back
 *   Authorization: Bearer <the app's Clerk "convex" JWT>
 *
 * The caller must be signed in, and the scan must be theirs — checked on
 * every request (convex/bodyScans.ts: imageForOwner). No storage URL is
 * ever minted for these images, so there's no bearer link to leak. A scan
 * that doesn't exist and another user's scan get the same 404. Responses
 * are never cached by intermediaries or on disk.
 */
http.route({
  path: "/body-scan-image",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const noStore = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" };
    const identity = await bodyScanIdentity(ctx);
    if (!identity) return new Response("Unauthorized", { status: 401, headers: noStore });
    const url = new URL(request.url);
    const storageId = await ctx.runQuery(internal.bodyScans.imageForOwner, {
      tokenIdentifier: identity.tokenIdentifier,
      scanId: url.searchParams.get("scanId") ?? "",
      view: url.searchParams.get("view") ?? "",
    });
    if (!storageId) return new Response("Not found", { status: 404, headers: noStore });
    const blob = await ctx.storage.get(storageId);
    if (!blob) return new Response("Not found", { status: 404, headers: noStore });
    return new Response(blob, { status: 200, headers: { ...noStore, "Content-Type": "image/jpeg" } });
  }),
});

/**
 * Body Scan uploads (Phase 5E) — the authenticated way an image enters storage.
 *
 *   POST /body-scan-upload            (body: the JPEG, ≤ 8 MB)
 *   Authorization: Bearer <the app's Clerk "convex" JWT>
 *   → 200 {"storageId": "..."}  · 401 not signed in · 403 no Body Scan consent
 *     · 413 too large · 415 not a JPEG
 *
 * The blob is bound to its owner the moment it's stored (bodyScanUploads),
 * so an upload that's never attached (the app closed mid-save) is deleted by
 * the hourly sweep — and only blobs created here are ever swept. The image
 * still becomes part of a scan only through bodyScans:attachView.
 */
http.route({
  path: "/body-scan-upload",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const noStore = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" };
    const identity = await bodyScanIdentity(ctx);
    if (!identity) return new Response("Unauthorized", { status: 401, headers: noStore });
    const permission = await ctx.runQuery(internal.bodyScans.uploadPermission, { tokenIdentifier: identity.tokenIdentifier });
    if (!permission.ok) return new Response("Not allowed", { status: permission.status, headers: noStore });
    if (!(request.headers.get("Content-Type") ?? "").startsWith("image/jpeg")) return new Response("JPEG only", { status: 415, headers: noStore });
    const declared = Number(request.headers.get("Content-Length") ?? "0");
    if (declared > 8_000_000) return new Response("Too large", { status: 413, headers: noStore });
    const blob = await request.blob();
    if (blob.size === 0 || blob.size > 8_000_000) return new Response("Too large", { status: 413, headers: noStore });
    const storageId = await ctx.storage.store(new Blob([blob], { type: "image/jpeg" }));
    const recorded = await ctx.runMutation(internal.bodyScans.recordUpload, { tokenIdentifier: identity.tokenIdentifier, storageId });
    if (!recorded.ok) return new Response("Not allowed", { status: 403, headers: noStore });
    return new Response(JSON.stringify({ storageId }), { status: 200, headers: { ...noStore, "Content-Type": "application/json" } });
  }),
});

// REQUIRED: must be the default export
export default http;
