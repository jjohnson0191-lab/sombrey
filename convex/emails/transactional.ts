"use node";

import escapeHtml from "escape-html";
import { Hercules } from "@usehercules/sdk";
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import {
  buildEmailHtml,
  ctaButton,
  infoBox,
  para,
  divider,
  SENDER,
  APP_URL,
} from "./templates.js";

const hercules = new Hercules({
  apiKey: process.env.HERCULES_API_KEY!,
  apiVersion: "2025-12-09",
});

// ─── Welcome Email ────────────────────────────────────────────────────────────

export const sendWelcomeEmail = internalAction({
  args: {
    toEmail: v.string(),
    name: v.string(),
  },
  handler: async (_ctx, { toEmail, name }) => {
    const safeName = escapeHtml(name || "Athlete");
    const body = `
      ${para(`Hey <strong style="color:#fff;">${safeName}</strong> 👋`)}
      ${para("Welcome to GOAT WALK — your AI-powered fitness coaching platform. You're now part of an elite community of athletes pursuing peak performance.")}
      ${divider()}
      ${para("<strong style=\"color:#fff;\">Here's what's waiting for you:</strong>")}
      <ul style="margin:0 0 24px;padding-left:20px;color:#aaa;font-size:15px;line-height:2;">
        <li>Personalised AI 12-week training plan</li>
        <li>Weekly progress check-ins with body composition tracking</li>
        <li>AI macro & nutrition coaching</li>
        <li>Progressive overload workout logger</li>
      </ul>
      ${ctaButton("Open GOAT WALK", APP_URL)}
      ${para("Complete your onboarding to unlock your personalised plan.", true)}
    `;
    await hercules.email.send({
      from: SENDER,
      to: toEmail,
      subject: `Welcome to GOAT WALK, ${safeName} 🔥`,
      html: buildEmailHtml({
        title: `Welcome, ${safeName}`,
        eyebrow: "WELCOME",
        bodyHtml: body,
      }),
      text: `Welcome to GOAT WALK, ${safeName}! Open the app to complete your onboarding: ${APP_URL}`,
    });
  },
});

// ─── Subscription Confirmation ────────────────────────────────────────────────

export const sendSubscriptionConfirmationEmail = internalAction({
  args: {
    toEmail: v.string(),
    name: v.string(),
    planName: v.string(),
    amount: v.string(),
    nextBillingDate: v.string(),
  },
  handler: async (_ctx, { toEmail, name, planName, amount, nextBillingDate }) => {
    const safeName = escapeHtml(name || "Athlete");
    const safePlan = escapeHtml(planName);
    const safeAmount = escapeHtml(amount);
    const safeDate = escapeHtml(nextBillingDate);

    const body = `
      ${para(`Your subscription is now active, <strong style="color:#fff;">${safeName}</strong>. You now have full access to premium GOAT WALK features.`)}
      ${infoBox([
        { label: "Plan", value: safePlan },
        { label: "Amount", value: safeAmount },
        { label: "Next Billing Date", value: safeDate },
      ])}
      ${para("<strong style=\"color:#fff;\">Premium includes:</strong>")}
      <ul style="margin:0 0 24px;padding-left:20px;color:#aaa;font-size:15px;line-height:2;">
        <li>AI-generated personalised 12-week plan</li>
        <li>Weekly check-in assessments with AI body composition analysis</li>
        <li>Progressive overload training system</li>
        <li>AI macro adjustment engine</li>
      </ul>
      ${ctaButton("Start Your Journey", APP_URL)}
      ${para("To manage or cancel your subscription, visit your Profile → My Subscription inside the app.", true)}
    `;
    await hercules.email.send({
      from: SENDER,
      to: toEmail,
      subject: "GOAT WALK Premium — Subscription Confirmed",
      html: buildEmailHtml({
        title: "Subscription Confirmed",
        eyebrow: "SUBSCRIPTION",
        bodyHtml: body,
      }),
      text: `Your GOAT WALK ${safePlan} subscription is active. Amount: ${safeAmount}. Next billing: ${safeDate}. Open the app: ${APP_URL}`,
    });
  },
});

// ─── Subscription Cancellation ────────────────────────────────────────────────

export const sendSubscriptionCancellationEmail = internalAction({
  args: {
    toEmail: v.string(),
    name: v.string(),
    planName: v.string(),
    accessUntil: v.string(),
  },
  handler: async (_ctx, { toEmail, name, planName, accessUntil }) => {
    const safeName = escapeHtml(name || "Athlete");
    const safePlan = escapeHtml(planName);
    const safeDate = escapeHtml(accessUntil);

    const body = `
      ${para(`Hi <strong style="color:#fff;">${safeName}</strong>,`)}
      ${para("We've received your cancellation request. Your subscription has been cancelled.")}
      ${infoBox([
        { label: "Cancelled Plan", value: safePlan },
        { label: "Premium Access Until", value: safeDate },
      ])}
      ${para("You'll retain full premium access until the end of your current billing period. After that, your account will revert to the free tier.")}
      ${divider()}
      ${para("Changed your mind? You can resubscribe at any time from inside the app.")}
      ${ctaButton("Reactivate Premium", `${APP_URL}/subscription`)}
      ${para("If you have feedback about your experience, we'd love to hear it — reply to this email.", true)}
    `;
    await hercules.email.send({
      from: SENDER,
      to: toEmail,
      subject: "GOAT WALK Premium — Subscription Cancelled",
      html: buildEmailHtml({
        title: "Subscription Cancelled",
        eyebrow: "SUBSCRIPTION",
        bodyHtml: body,
        footerNote: `Access continues until ${safeDate}.`,
      }),
      text: `Hi ${safeName}, your ${safePlan} subscription has been cancelled. You have premium access until ${safeDate}. Resubscribe at ${APP_URL}/subscription`,
    });
  },
});

// ─── AI Plan Ready ────────────────────────────────────────────────────────────

export const sendAiPlanReadyEmail = internalAction({
  args: {
    toEmail: v.string(),
    name: v.string(),
    primaryGoal: v.string(),
    weekCount: v.number(),
  },
  handler: async (_ctx, { toEmail, name, primaryGoal, weekCount }) => {
    const safeName = escapeHtml(name || "Athlete");
    const safeGoal = escapeHtml(primaryGoal);

    const body = `
      ${para(`Your personalised AI plan is ready, <strong style="color:#fff;">${safeName}</strong>.`)}
      ${infoBox([
        { label: "Primary Goal", value: safeGoal },
        { label: "Plan Duration", value: `${weekCount} Weeks` },
        { label: "Training System", value: "Progressive Overload (15/12/10/8)" },
      ])}
      ${para("Your plan has been generated based on your goals, body metrics, and baseline check-in data. It adapts each week as you progress.")}
      ${divider()}
      ${para("<strong style=\"color:#fff;\">What happens next:</strong>")}
      <ul style="margin:0 0 24px;padding-left:20px;color:#aaa;font-size:15px;line-height:2;">
        <li>Start your first workout from the <strong style="color:#ddd;">Train</strong> tab</li>
        <li>Log meals in the <strong style="color:#ddd;">Nutrition</strong> section</li>
        <li>Complete your weekly check-in every 7 days</li>
      </ul>
      ${ctaButton("View Your Plan", `${APP_URL}/ai-plan`)}
    `;
    await hercules.email.send({
      from: SENDER,
      to: toEmail,
      subject: "Your GOAT WALK AI Plan is Ready 🎯",
      html: buildEmailHtml({
        title: "Your AI Plan is Ready",
        eyebrow: "AI COACHING",
        bodyHtml: body,
      }),
      text: `Hi ${safeName}, your GOAT WALK AI plan (${weekCount} weeks, goal: ${safeGoal}) is ready. Open the app: ${APP_URL}/ai-plan`,
    });
  },
});

// ─── AI Plan Updated ──────────────────────────────────────────────────────────

export const sendAiPlanUpdatedEmail = internalAction({
  args: {
    toEmail: v.string(),
    name: v.string(),
    weekNumber: v.number(),
    changeDescription: v.string(),
  },
  handler: async (_ctx, { toEmail, name, weekNumber, changeDescription }) => {
    const safeName = escapeHtml(name || "Athlete");
    const safeChange = escapeHtml(changeDescription);

    const body = `
      ${para(`Hey <strong style="color:#fff;">${safeName}</strong>,`)}
      ${para(`Your GOAT WALK AI Coach has updated your plan based on your Week ${weekNumber} check-in data.`)}
      ${infoBox([
        { label: "Week", value: `Week ${weekNumber}` },
        { label: "Update", value: safeChange },
      ])}
      ${para("Your plan evolves to match your progress — this update ensures your training and nutrition remain optimised for your goals.")}
      ${ctaButton("View Updated Plan", `${APP_URL}/ai-plan`)}
      ${para("Have questions about your plan? Chat with your AI Coach inside the app.", true)}
    `;
    await hercules.email.send({
      from: SENDER,
      to: toEmail,
      subject: `Your GOAT WALK Plan Has Been Updated — Week ${weekNumber}`,
      html: buildEmailHtml({
        title: "Your Plan Has Been Updated",
        eyebrow: "AI COACHING",
        bodyHtml: body,
      }),
      text: `Hi ${safeName}, your GOAT WALK AI plan has been updated for Week ${weekNumber}: ${safeChange}. View it at ${APP_URL}/ai-plan`,
    });
  },
});

// ─── Weekly Check-In Reminder ─────────────────────────────────────────────────

export const sendCheckInReminderEmail = internalAction({
  args: {
    toEmail: v.string(),
    name: v.string(),
    weekNumber: v.number(),
    dueDate: v.string(),
  },
  handler: async (_ctx, { toEmail, name, weekNumber, dueDate }) => {
    const safeName = escapeHtml(name || "Athlete");
    const safeDate = escapeHtml(dueDate);

    const body = `
      ${para(`Hey <strong style="color:#fff;">${safeName}</strong>,`)}
      ${para(`Your Week <strong style="color:#fff;">${weekNumber}</strong> check-in is due. Completing it keeps your AI plan accurate and unlocks next week's workouts.`)}
      ${infoBox([
        { label: "Check-In Week", value: `Week ${weekNumber}` },
        { label: "Due By", value: safeDate },
      ])}
      ${para("Your check-in takes less than 5 minutes and includes a progress photo, weight, and measurements. Your AI Coach uses this data to refine your plan.")}
      ${ctaButton("Complete Check-In Now", `${APP_URL}/check-in`)}
      ${para("Don't skip — consistent check-ins are how your AI Coach keeps you on track.", true)}
    `;
    await hercules.email.send({
      from: SENDER,
      to: toEmail,
      subject: `⏰ Week ${weekNumber} Check-In Due — GOAT WALK`,
      html: buildEmailHtml({
        title: `Week ${weekNumber} Check-In Due`,
        eyebrow: "CHECK-IN REMINDER",
        bodyHtml: body,
        footerNote: `Due by ${safeDate}. You can manage email preferences in your Profile settings.`,
      }),
      text: `Hi ${safeName}, your Week ${weekNumber} GOAT WALK check-in is due by ${safeDate}. Complete it at ${APP_URL}/check-in`,
    });
  },
});

// ─── Missed Check-In Notification ────────────────────────────────────────────

export const sendMissedCheckInEmail = internalAction({
  args: {
    toEmail: v.string(),
    name: v.string(),
    weekNumber: v.number(),
  },
  handler: async (_ctx, { toEmail, name, weekNumber }) => {
    const safeName = escapeHtml(name || "Athlete");

    const body = `
      ${para(`Hey <strong style="color:#fff;">${safeName}</strong>,`)}
      ${para(`It looks like you missed your Week <strong style="color:#fff;">${weekNumber}</strong> check-in. Your AI Coach can't adapt your plan without it.`)}
      ${divider()}
      ${para("No worries — you can still complete it now. The sooner you check in, the sooner your plan re-syncs with your progress.")}
      ${para("<strong style=\"color:#fff;\">Why check-ins matter:</strong>")}
      <ul style="margin:0 0 24px;padding-left:20px;color:#aaa;font-size:15px;line-height:2;">
        <li>Unlocks your next week's training plan</li>
        <li>Allows your AI Coach to adjust macros based on real results</li>
        <li>Tracks body composition changes over time</li>
      </ul>
      ${ctaButton("Complete Your Check-In", `${APP_URL}/check-in`)}
      ${para("Consistency is what separates the GOATs from the rest.", true)}
    `;
    await hercules.email.send({
      from: SENDER,
      to: toEmail,
      subject: `You Missed Your Week ${weekNumber} Check-In — GOAT WALK`,
      html: buildEmailHtml({
        title: `Week ${weekNumber} Check-In Overdue`,
        eyebrow: "MISSED CHECK-IN",
        bodyHtml: body,
        footerNote: "You can manage email preferences in your Profile settings.",
      }),
      text: `Hi ${safeName}, you missed your Week ${weekNumber} GOAT WALK check-in. Complete it now at ${APP_URL}/check-in`,
    });
  },
});
