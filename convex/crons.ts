import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

/**
 * Daily check-in reminder cron — 9:00 AM UTC.
 *
 * Sends weekly check-in reminders and missed check-in notifications
 * to premium users who haven't completed their current week's check-in.
 *
 * Note: This cron job consumes Hercules Cloud resources (function calls,
 * database reads, action compute, and email sends). It runs once per day.
 * Monitor usage at Settings > Billing > Hercules Cloud.
 */
crons.daily(
  "weekly check-in reminders",
  { hourUTC: 9, minuteUTC: 0 },
  internal.emails.checkInCron.processReminders,
);

/** Body Scan: unfinished scans older than a day are removed, images included. */
crons.hourly(
  "body scan abandoned cleanup",
  { minuteUTC: 17 },
  internal.bodyScans.cleanupAbandoned,
);

/** Body Scan: uploads never attached within an hour (app closed mid-save) are deleted. */
crons.hourly(
  "body scan orphan upload cleanup",
  { minuteUTC: 47 },
  internal.bodyScans.cleanupOrphanUploads,
);

export default crons;
