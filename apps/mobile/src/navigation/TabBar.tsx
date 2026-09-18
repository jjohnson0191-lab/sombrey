import { NavLink } from "react-router-dom";
import { Home, Dumbbell, Apple, TrendingUp, User } from "lucide-react";
import { cn } from "@sombrey/shared";

/**
 * The approved five-tab primary navigation. Built fresh for Sombrey —
 * does not import the legacy app's app-layout.tsx. AI Assistant and
 * History are deliberately NOT here: they're contextual surfaces reached
 * from within these five tabs, not primary destinations (see the product
 * spec — a sixth tab was explicitly rejected).
 */
const TABS = [
  { to: "/home", label: "Home", icon: Home },
  { to: "/train", label: "Train", icon: Dumbbell },
  { to: "/nutrition", label: "Nutrition", icon: Apple },
  { to: "/progress", label: "Progress", icon: TrendingUp },
  { to: "/profile", label: "Profile", icon: User },
] as const;

export function TabBar() {
  return (
    <nav
      className={cn(
        "fixed bottom-0 left-0 right-0 z-50 border-t border-border-subtle",
        "bg-surface/95 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]",
      )}
    >
      <div className="mx-auto flex max-w-lg items-center justify-around px-1 pt-2 pb-1">
        {TABS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className="flex flex-col items-center gap-1 px-3 py-1.5"
          >
            {({ isActive }) => (
              <>
                <Icon
                  className={cn("h-5 w-5", isActive ? "text-accent" : "text-foreground-faint")}
                  strokeWidth={isActive ? 2.25 : 1.75}
                />
                <span
                  className={cn(
                    "text-[10px] font-medium",
                    isActive ? "text-accent" : "text-foreground-faint",
                  )}
                >
                  {label}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
