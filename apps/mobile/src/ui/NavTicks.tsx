import { NavLink } from "react-router-dom";
import { cn } from "@sombrey/shared";

/**
 * Sombrey's primary navigation — five instrument ticks, not a generic
 * icon tab bar. Approved IA: Home, Train, Progress, AI (Sombrey Coach),
 * Settings. This supersedes the earlier five-tab set (Home / Train /
 * Nutrition / Progress / Profile) and the earlier note that a sixth
 * "AI" tab was rejected — the approved Studio Instrument screens put AI
 * on equal footing with Home/Train/Progress in every round, and Nutrition
 * is now a row inside Home rather than its own destination (its screen
 * still exists, reached from that row). See the implementation report.
 *
 * Every tick's visible mark is small (20x3px lit / 12x3px dim) but its
 * tap target is a real 44x44pt hit area — the visual restraint doesn't
 * cost accessibility. A tiny always-visible label (not icon) keeps it
 * discoverable without a bar, a pill, or icon soup.
 */
const TICKS = [
  { to: "/home", label: "Home" },
  { to: "/train", label: "Train" },
  { to: "/progress", label: "Progress" },
  { to: "/ai", label: "AI" },
  { to: "/settings", label: "Settings" },
] as const;

export function NavTicks() {
  return (
    <nav
      className="flex items-center justify-between px-10 pb-3 pt-3"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}
    >
      {TICKS.map(({ to, label }) => (
        <NavLink
          key={to}
          to={to}
          className="flex h-11 w-11 flex-col items-center justify-center gap-1.5"
          aria-label={label}
        >
          {({ isActive }) => (
            <>
              <span
                className={cn(
                  "rounded-full transition-all",
                  isActive ? "h-[3px] w-5 bg-accent-ink" : "h-[3px] w-3 bg-ink/30",
                )}
              />
              <span className={cn("text-[9px]", isActive ? "font-semibold text-ink" : "text-ink/42")}>
                {label}
              </span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
