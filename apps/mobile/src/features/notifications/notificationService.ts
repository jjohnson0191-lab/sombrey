/**
 * Notifications boundary — interface only, per Phase 3 scope (no APNs
 * implementation). Categories match the approved product spec: workout
 * reminders, weekly check-ins, low battery, sync reminders, subscription
 * events. No marketing/promotional push category exists here — that was
 * explicitly excluded from V1, and adding one later is a deliberate,
 * visible change to this file, not something that silently creeps in.
 */

export type NotificationCategory =
  | "workout_reminder"
  | "weekly_checkin"
  | "low_battery"
  | "sync_reminder"
  | "subscription_event";

export interface SombreyNotificationService {
  requestPermission(): Promise<boolean>;
  registerDeviceToken(): Promise<void>;
  getPreferences(): Promise<Record<NotificationCategory, boolean>>;
  setPreference(category: NotificationCategory, enabled: boolean): Promise<void>;
}

/** Not implemented in Phase 3 — APNs wiring is a later phase. */
export const sombreyNotificationService: SombreyNotificationService = {
  async requestPermission() {
    return false;
  },
  async registerDeviceToken() {
    throw new Error("APNs is not implemented yet — see the Phase 3 report.");
  },
  async getPreferences() {
    return {
      workout_reminder: true,
      weekly_checkin: true,
      low_battery: true,
      sync_reminder: false,
      subscription_event: true,
    };
  },
  async setPreference() {
    throw new Error("APNs is not implemented yet — see the Phase 3 report.");
  },
};
