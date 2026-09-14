"use node";

import escapeHtml from "escape-html";
import { Hercules } from "@usehercules/sdk";
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { buildEmailHtml, ctaButton, infoBox, para, divider, SENDER, APP_URL } from "./templates.js";

const hercules = new Hercules({
  apiKey: process.env.HERCULES_API_KEY!,
  apiVersion: "2025-12-09",
});

// ─── Support ticket confirmation to user ─────────────────────────────────────

export const sendSupportConfirmation = internalAction({
  args: {
    toEmail: v.string(),
    name: v.string(),
    ticketId: v.string(),
    subject: v.string(),
    message: v.string(),
  },
  handler: async (_ctx, { toEmail, name, ticketId, subject, message }) => {
    const safeName = escapeHtml(name || "Athlete");
    const safeSubject = escapeHtml(subject);
    const safeMessage = escapeHtml(message);
    const safeId = escapeHtml(ticketId);

    const body = `
      ${para(`Hi <strong style="color:#fff;">${safeName}</strong>,`)}
      ${para("We've received your support request. Our team will get back to you within 24–48 hours.")}
      ${infoBox([
        { label: "Ticket ID", value: `#${safeId.slice(-8).toUpperCase()}` },
        { label: "Subject", value: safeSubject },
      ])}
      <div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:10px;padding:16px 20px;margin-bottom:24px;">
        <p style="margin:0 0 6px;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#666;">Your Message</p>
        <p style="margin:0;font-size:14px;color:#bbb;line-height:1.7;">${safeMessage}</p>
      </div>
      ${divider()}
      ${para("You'll receive a reply to this email address. You can also view your ticket status in the app.", true)}
    `;
    await hercules.email.send({
      from: SENDER,
      reply_to: "Admin@app.agoatwalk.com",
      to: toEmail,
      subject: `Support Request Received — #${ticketId.slice(-8).toUpperCase()}`,
      html: buildEmailHtml({
        title: "Support Request Received",
        eyebrow: "SUPPORT",
        bodyHtml: body,
        footerNote: "Reply to this email or visit the app to follow up on your ticket.",
      }),
      text: `Hi ${safeName}, we received your support request (Ticket #${ticketId.slice(-8).toUpperCase()}): "${subject}". We'll reply within 24-48 hours.`,
    });
  },
});

// ─── Admin reply to user ──────────────────────────────────────────────────────

export const sendSupportReply = internalAction({
  args: {
    toEmail: v.string(),
    name: v.string(),
    ticketId: v.string(),
    subject: v.string(),
    replyMessage: v.string(),
    adminName: v.string(),
  },
  handler: async (_ctx, { toEmail, name, ticketId, subject, replyMessage, adminName }) => {
    const safeName = escapeHtml(name || "Athlete");
    const safeSubject = escapeHtml(subject);
    const safeReply = escapeHtml(replyMessage);
    const safeAdmin = escapeHtml(adminName);
    const safeId = escapeHtml(ticketId);

    const body = `
      ${para(`Hi <strong style="color:#fff;">${safeName}</strong>,`)}
      ${para(`The GOAT WALK support team has replied to your ticket.`)}
      ${infoBox([
        { label: "Ticket ID", value: `#${safeId.slice(-8).toUpperCase()}` },
        { label: "Subject", value: safeSubject },
        { label: "From", value: safeAdmin },
      ])}
      <div style="background:#1a2236;border:1px solid #1e3a5f;border-left:3px solid #4169E1;border-radius:10px;padding:16px 20px;margin-bottom:24px;">
        <p style="margin:0 0 6px;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#4169E1;">Reply from GOAT WALK Support</p>
        <p style="margin:0;font-size:15px;color:#cdd;line-height:1.7;">${safeReply}</p>
      </div>
      ${divider()}
      ${para("To reply, simply respond to this email or contact us again via Contact Support in the app.", true)}
    `;
    await hercules.email.send({
      from: SENDER,
      reply_to: "Admin@app.agoatwalk.com",
      to: toEmail,
      subject: `Re: ${subject} — Ticket #${ticketId.slice(-8).toUpperCase()}`,
      html: buildEmailHtml({
        title: "Reply from GOAT WALK Support",
        eyebrow: "SUPPORT",
        bodyHtml: body,
      }),
      text: `Hi ${safeName}, reply from ${adminName} on ticket #${ticketId.slice(-8).toUpperCase()}: ${replyMessage}`,
    });
  },
});

// ─── Admin notification: new ticket ──────────────────────────────────────────

export const sendAdminNewTicketNotification = internalAction({
  args: {
    adminEmail: v.string(),
    ticketId: v.string(),
    userName: v.string(),
    userEmail: v.string(),
    subscriptionTier: v.string(),
    subject: v.string(),
    message: v.string(),
    deviceInfo: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const safeName = escapeHtml(args.userName);
    const safeEmail = escapeHtml(args.userEmail);
    const safeTier = escapeHtml(args.subscriptionTier);
    const safeSubject = escapeHtml(args.subject);
    const safeMessage = escapeHtml(args.message);
    const safeDevice = escapeHtml(args.deviceInfo ?? "Unknown");
    const safeId = escapeHtml(args.ticketId);

    const body = `
      ${para(`A new support ticket has been submitted.`)}
      ${infoBox([
        { label: "Ticket ID", value: `#${safeId.slice(-8).toUpperCase()}` },
        { label: "From", value: `${safeName} &lt;${safeEmail}&gt;` },
        { label: "Subscription", value: safeTier },
        { label: "Subject", value: safeSubject },
        { label: "Device", value: safeDevice },
      ])}
      <div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:10px;padding:16px 20px;margin-bottom:24px;">
        <p style="margin:0 0 6px;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#666;">Message</p>
        <p style="margin:0;font-size:14px;color:#bbb;line-height:1.7;">${safeMessage}</p>
      </div>
      ${ctaButton("View in Admin Dashboard", `${APP_URL}/owner`)}
    `;
    await hercules.email.send({
      from: SENDER,
      to: args.adminEmail,
      subject: `[GOAT WALK Support] New Ticket — ${args.subject}`,
      html: buildEmailHtml({
        title: "New Support Ticket",
        eyebrow: "ADMIN ALERT",
        bodyHtml: body,
      }),
      text: `New support ticket from ${args.userName} <${args.userEmail}> (${args.subscriptionTier}): "${args.subject}" — ${args.message}`,
    });
  },
});
