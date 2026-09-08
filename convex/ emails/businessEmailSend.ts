"use node";

/**
 * Mailgun outbound email sender for GOAT WALK Business Email.
 * Uses the Mailgun REST API via fetch — no SDK required.
 * Requires secrets: MAILGUN_API_KEY, MAILGUN_DOMAIN
 */

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";

const MAILGUN_BASE = "https://api.mailgun.net/v3";
const FROM = "GOAT WALK <admin@agoatwalk.com>";

function getCredentials() {
  const apiKey = process.env.MAILGUN_API_KEY;
  const domain = process.env.MAILGUN_DOMAIN;
  if (!apiKey) throw new Error("MAILGUN_API_KEY secret is not set");
  if (!domain) throw new Error("MAILGUN_DOMAIN secret is not set");
  return { apiKey, domain };
}

/** Send a business email via Mailgun REST API. */
export const sendBusinessEmail = internalAction({
  args: {
    toAddresses: v.array(v.string()),
    ccAddresses: v.array(v.string()),
    bccAddresses: v.array(v.string()),
    subject: v.string(),
    body: v.string(),
    sentEmailId: v.id("businessEmails"),
  },
  handler: async (ctx, args): Promise<void> => {
    const { apiKey, domain } = getCredentials();

    // Build a clean plain-text + HTML email body
    const htmlBody = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/></head>
<body style="font-family:Arial,sans-serif;background:#0a0a0a;color:#ccc;padding:32px;">
  <div style="max-width:600px;margin:0 auto;background:#111;border:1px solid #222;border-top:2px solid #4169E1;border-radius:12px;padding:32px;">
    <p style="font-size:10px;letter-spacing:4px;text-transform:uppercase;color:#4169E1;margin:0 0 8px;">GOAT WALK · BUSINESS</p>
    <h2 style="color:#fff;margin:0 0 24px;">${escapeHtml(args.subject)}</h2>
    <div style="font-size:15px;line-height:1.7;color:#aaa;white-space:pre-wrap;">${escapeHtml(args.body)}</div>
    <hr style="border:none;border-top:1px solid #1e1e1e;margin:28px 0 16px;"/>
    <p style="font-size:11px;color:#444;text-align:center;">GOAT WALK — admin@agoatwalk.com</p>
  </div>
</body></html>`;

    const params = new URLSearchParams();
    params.append("from", FROM);
    params.append("subject", args.subject);
    params.append("text", args.body);
    params.append("html", htmlBody);

    // Add recipients
    for (const to of args.toAddresses) params.append("to", to);
    for (const cc of args.ccAddresses) params.append("cc", cc);
    for (const bcc of args.bccAddresses) params.append("bcc", bcc);

    const response = await fetch(`${MAILGUN_BASE}/${domain}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("[Mailgun] Send failed:", response.status, error);
      // Patch the sent record to mark send failure in notes
      await ctx.runMutation(internal.businessEmails.patchMessageId, {
        id: args.sentEmailId,
        mailgunMessageId: `error_${Date.now()}`,
      });
      throw new Error(`Mailgun send failed: ${response.status} ${error}`);
    }

    const result = (await response.json()) as { id?: string };
    const msgId = result.id ?? `sent_${Date.now()}`;
    await ctx.runMutation(internal.businessEmails.patchMessageId, {
      id: args.sentEmailId,
      mailgunMessageId: msgId,
    });
  },
});

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
