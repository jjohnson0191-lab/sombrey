/**
 * Embedded calendar for a specific client — used inside the Client Dashboard tab.
 * Delegates to the unified CoachCalendar with the client pre-selected.
 */
import CoachCalendar from "./coach-calendar.tsx";
import type { Id } from "@/convex/_generated/dataModel.js";

export default function CoachCalendarForClient({ clientId }: { clientId: Id<"users"> }) {
  return <CoachCalendar filterClientId={clientId} />;
}
