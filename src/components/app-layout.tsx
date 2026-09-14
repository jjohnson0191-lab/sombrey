import { Outlet, NavLink, useLocation, useNavigate } from "react-router-dom";
import { Home, Dumbbell, ShoppingBag, Users, CalendarDays, ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import { motion } from "motion/react";
import { useQuery } from "convex/react";
import { Authenticated } from "convex/react";
import { api } from "@/convex/_generated/api.js";

// Routes that are "root" tabs — no back button on these
const ROOT_ROUTES = new Set([
  "/dashboard",
  "/exercises",
  "/calendar",
  "/store",
  "/community",
  "/profile",
]);

function isRootRoute(pathname: string) {
  for (const route of ROOT_ROUTES) {
    if (pathname === route) return true;
  }
  return false;
}

const NAV_ITEMS = [
  { to: "/dashboard", icon: Home, label: "Home" },
  { to: "/exercises", icon: Dumbbell, label: "Train" },
  { to: "/calendar", icon: CalendarDays, label: "Calendar" },
  { to: "/store", icon: ShoppingBag, label: "Store", storeIcon: true },
  { to: "/community", icon: Users, label: "Community" },
] as const;

function CartBadge() {
  const count = useQuery(api.cart.getCartCount, {});
  if (!count) return null;
  return (
    <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center z-10 shadow-sm">
      {count > 9 ? "9+" : count}
    </span>
  );
}

// Profile tab shows avatar if available, otherwise initials fallback
function ProfileNavItem({ isActive }: { isActive: boolean }) {
  const currentUser = useQuery(api.users.getCurrentUser, {});
  const initial = (currentUser?.name ?? "?")[0]?.toUpperCase() ?? "?";

  return (
    <div className="flex flex-col items-center gap-1 px-2 py-1.5 relative">
      <span className="relative">
        {currentUser?.avatarUrl ? (
          <img
            src={currentUser.avatarUrl}
            alt={currentUser.name ?? "Profile"}
            className={cn(
              "w-5 h-5 rounded-full object-cover transition-all duration-200",
              isActive
                ? "ring-2 ring-primary ring-offset-1 ring-offset-background"
                : "ring-1 ring-border"
            )}
          />
        ) : (
          <span
            className={cn(
              "w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black transition-all duration-200",
              isActive
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground"
            )}
          >
            {initial}
          </span>
        )}
      </span>
      <span
        className={cn(
          "text-[10px] font-semibold tracking-wide transition-colors duration-200",
          isActive ? "text-primary" : "text-muted-foreground"
        )}
      >
        Profile
      </span>
    </div>
  );
}

export default function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const profileActive =
    location.pathname === "/profile" || location.pathname.startsWith("/profile/");

  const showBackButton = !isRootRoute(location.pathname);

  return (
    <div className="flex flex-col h-dvh overflow-hidden bg-background">
      {/* Back bar — shown on all secondary pages */}
      {showBackButton && (
        <div className="shrink-0 flex items-center px-3 pt-2 pb-1.5 border-b border-border/40 bg-background/98 backdrop-blur-xl z-40">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-all cursor-pointer active:scale-95"
            aria-label="Go back"
          >
            <ChevronLeft className="w-4 h-4" />
            <span className="text-sm font-semibold tracking-tight">Back</span>
          </button>
        </div>
      )}

      {/* Scrollable content area */}
      <main className="flex-1 overflow-y-auto pb-20">
        <Outlet />
      </main>

      {/* Bottom Navigation — electric blue active, premium finish */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/50 bg-background/96 backdrop-blur-2xl">
        {/* Subtle top glow line */}
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />

        <div className="flex items-center justify-around max-w-lg mx-auto px-1 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))]">
          {NAV_ITEMS.map(({ to, icon: Icon, label }) => {
            const isActive =
              location.pathname === to || location.pathname.startsWith(to + "/");
            const isStore = to === "/store";
            return (
              <NavLink
                key={to}
                to={to}
                className="flex flex-col items-center gap-1 px-2 py-1.5 cursor-pointer relative group"
              >
                {/* Active pill background */}
                {isActive && (
                  <motion.div
                    layoutId="bottom-nav-indicator"
                    className="absolute inset-0 rounded-xl bg-primary/12"
                    transition={{ type: "spring", stiffness: 450, damping: 38 }}
                  />
                )}

                {/* Icon */}
                <span className="relative">
                  {isStore ? (
                    <img
                      src="https://hercules-cdn.com/file_0H56FYSSw3G9uvKvA697ijiY"
                      alt="GOAT WALK Store"
                      className={cn(
                        "w-5 h-5 rounded-sm object-cover transition-all duration-200",
                        isActive ? "opacity-100" : "opacity-40"
                      )}
                    />
                  ) : (
                    <Icon
                      className={cn(
                        "w-5 h-5 transition-all duration-200 relative",
                        isActive
                          ? "text-primary drop-shadow-[0_0_6px_oklch(0.62_0.22_255/0.6)]"
                          : "text-muted-foreground group-hover:text-foreground/70"
                      )}
                      strokeWidth={isActive ? 2.5 : 1.75}
                    />
                  )}
                  {isStore && (
                    <Authenticated>
                      <CartBadge />
                    </Authenticated>
                  )}
                </span>

                {/* Label — always visible */}
                <span
                  className={cn(
                    "text-[10px] font-semibold tracking-wide transition-all duration-200 relative",
                    isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground/70"
                  )}
                >
                  {label}
                </span>

                {/* Active dot under label */}
                {isActive && (
                  <motion.span
                    layoutId="nav-dot"
                    className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary"
                    transition={{ type: "spring", stiffness: 450, damping: 38 }}
                  />
                )}
              </NavLink>
            );
          })}

          {/* Profile tab with avatar */}
          <NavLink to="/profile" className="cursor-pointer relative group">
            {profileActive && (
              <motion.div
                layoutId="bottom-nav-indicator"
                className="absolute inset-0 rounded-xl bg-primary/12"
                transition={{ type: "spring", stiffness: 450, damping: 38 }}
              />
            )}
            <Authenticated>
              <ProfileNavItem isActive={profileActive} />
            </Authenticated>
            {profileActive && (
              <motion.span
                layoutId="nav-dot"
                className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary"
                transition={{ type: "spring", stiffness: 450, damping: 38 }}
              />
            )}
          </NavLink>
        </div>
      </nav>
    </div>
  );
}
