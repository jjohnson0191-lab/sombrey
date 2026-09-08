"use node";

import { Hercules } from "@usehercules/sdk";
import escapeHtml from "escape-html";
import { v } from "convex/values";
import { internalAction } from "../_generated/server";

const hercules = new Hercules({
  apiKey: process.env.HERCULES_API_KEY!,
  apiVersion: "2025-12-09",
});

const TIER_LABELS: Record<string, string> = {
  free: "Shopping Experience Only (Free)",
  self_guided: "Hypertrophic – Self Guided ($4.99/month)",
  semi_guided: "Hypertrophic Coach – Semi Guided ($49.98/month)",
  full_guided: "Elite Hypertrophic – Full Guided ($499.98/month)",
};

// ─── Coach Invite Email ───────────────────────────────────────────────────────

export const sendCoachInviteEmail = internalAction({
  args: {
    inviteId: v.id("coachInvites"),
    toEmail: v.string(),
    ownerName: v.string(),
    token: v.string(),
    appUrl: v.string(),
  },
  handler: async (_ctx, args) => {
    const acceptUrl = `${args.appUrl}/invite/accept?token=${args.token}`;
    const safeEmail = escapeHtml(args.toEmail);
    const safeName = escapeHtml(args.ownerName);
    const safeUrl = escapeHtml(acceptUrl);

    await hercules.email.send({
      from: "noreply@goatwalk.onhercules.app",
      to: args.toEmail,
      subject: "You've been invited to join GOAT WALK as a Coach",
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          </head>
          <body style="margin:0;padding:0;background:#0a0a0a;font-family:'Helvetica Neue',Arial,sans-serif;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 16px;">
              <tr>
                <td align="center">
                  <table width="100%" style="max-width:520px;background:#111;border:1px solid #222;border-radius:16px;overflow:hidden;">
                    <tr>
                      <td style="background:linear-gradient(135deg,#1a1a1a 0%,#0d0d0d 100%);padding:32px 32px 24px;border-bottom:1px solid #222;">
                        <p style="margin:0 0 8px;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#888;">GOAT WALK</p>
                        <h1 style="margin:0;font-size:24px;font-weight:700;color:#fff;line-height:1.2;">
                          You're Invited to Coach
                        </h1>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:32px;">
                        <p style="margin:0 0 16px;font-size:15px;color:#aaa;line-height:1.6;">
                          Hi ${safeEmail},
                        </p>
                        <p style="margin:0 0 24px;font-size:15px;color:#aaa;line-height:1.6;">
                          <strong style="color:#fff;">${safeName}</strong> has invited you to join the GOAT WALK platform as a <strong style="color:#fff;">Coach</strong>.
                          Click the button below to accept your invite and get started.
                        </p>
                        <table width="100%" cellpadding="0" cellspacing="0">
                          <tr>
                            <td align="center" style="padding:8px 0 32px;">
                              <a href="${safeUrl}"
                                style="display:inline-block;background:#fff;color:#000;font-size:15px;font-weight:700;
                                       text-decoration:none;padding:14px 36px;border-radius:10px;letter-spacing:0.3px;">
                                Accept Invite &amp; Become a Coach
                              </a>
                            </td>
                          </tr>
                        </table>
                        <p style="margin:0 0 8px;font-size:13px;color:#666;line-height:1.5;">
                          This invite link expires in <strong style="color:#999;">7 days</strong> and can only be used once.
                        </p>
                        <p style="margin:0;font-size:12px;color:#555;line-height:1.5;">
                          If you did not expect this invitation, you can safely ignore this email.
                        </p>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:20px 32px;border-top:1px solid #1a1a1a;background:#0d0d0d;">
                        <p style="margin:0;font-size:11px;color:#444;text-align:center;">
                          GOAT WALK &mdash; Fitness Platform
                        </p>
                        <p style="margin:6px 0 0;font-size:11px;color:#333;text-align:center;word-break:break-all;">
                          Or copy this link: ${safeUrl}
                        </p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </body>
        </html>
      `,
    });
  },
});

// ─── Client Invite Email ──────────────────────────────────────────────────────

export const sendClientInviteEmail = internalAction({
  args: {
    inviteId: v.id("coachInvites"),
    toEmail: v.string(),
    clientName: v.string(),
    ownerName: v.string(),
    subscriptionTier: v.string(),
    token: v.string(),
    appUrl: v.string(),
  },
  handler: async (_ctx, args) => {
    const acceptUrl = `${args.appUrl}/invite/accept?token=${args.token}`;
    const safeName = escapeHtml(args.clientName);
    const safeOwner = escapeHtml(args.ownerName);
    const safeUrl = escapeHtml(acceptUrl);
    const tierLabel = escapeHtml(TIER_LABELS[args.subscriptionTier] ?? args.subscriptionTier);

    await hercules.email.send({
      from: "noreply@goatwalk.onhercules.app",
      to: args.toEmail,
      subject: "You've been invited to join GOAT WALK",
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          </head>
          <body style="margin:0;padding:0;background:#0a0a0a;font-family:'Helvetica Neue',Arial,sans-serif;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 16px;">
              <tr>
                <td align="center">
                  <table width="100%" style="max-width:520px;background:#111;border:1px solid #222;border-radius:16px;overflow:hidden;">
                    <tr>
                      <td style="background:linear-gradient(135deg,#1a1a1a 0%,#0d0d0d 100%);padding:32px 32px 24px;border-bottom:1px solid #222;">
                        <p style="margin:0 0 8px;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#888;">GOAT WALK</p>
                        <h1 style="margin:0;font-size:24px;font-weight:700;color:#fff;line-height:1.2;">
                          Your Fitness Journey Starts Here
                        </h1>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:32px;">
                        <p style="margin:0 0 16px;font-size:15px;color:#aaa;line-height:1.6;">
                          Hi ${safeName},
                        </p>
                        <p style="margin:0 0 20px;font-size:15px;color:#aaa;line-height:1.6;">
                          <strong style="color:#fff;">${safeOwner}</strong> has personally invited you to join <strong style="color:#fff;">GOAT WALK</strong> — an elite fitness coaching platform.
                        </p>

                        <!-- Subscription Tier Box -->
                        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                          <tr>
                            <td style="background:#1a1a1a;border:1px solid #333;border-radius:10px;padding:16px 20px;">
                              <p style="margin:0 0 4px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#666;">Your Plan</p>
                              <p style="margin:0;font-size:15px;font-weight:700;color:#fff;">${tierLabel}</p>
                              <p style="margin:6px 0 0;font-size:12px;color:#666;">
                                Activated automatically when you sign up
                              </p>
                            </td>
                          </tr>
                        </table>

                        <table width="100%" cellpadding="0" cellspacing="0">
                          <tr>
                            <td align="center" style="padding:8px 0 32px;">
                              <a href="${safeUrl}"
                                style="display:inline-block;background:#fff;color:#000;font-size:15px;font-weight:700;
                                       text-decoration:none;padding:14px 36px;border-radius:10px;letter-spacing:0.3px;">
                                Accept Invite &amp; Get Started
                              </a>
                            </td>
                          </tr>
                        </table>

                        <p style="margin:0 0 8px;font-size:13px;color:#666;line-height:1.5;">
                          This invite link expires in <strong style="color:#999;">7 days</strong> and can only be used once.
                        </p>
                        <p style="margin:0;font-size:12px;color:#555;line-height:1.5;">
                          If you did not expect this invitation, you can safely ignore this email.
                        </p>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:20px 32px;border-top:1px solid #1a1a1a;background:#0d0d0d;">
                        <p style="margin:0;font-size:11px;color:#444;text-align:center;">
                          GOAT WALK &mdash; Fitness Platform
                        </p>
                        <p style="margin:6px 0 0;font-size:11px;color:#333;text-align:center;word-break:break-all;">
                          Or copy this link: ${safeUrl}
                        </p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </body>
        </html>
      `,
    });
  },
});
