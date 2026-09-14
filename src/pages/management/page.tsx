/**
 * Management Page — accessible to owner/admin/coach roles.
 * Provides quick access to all backend admin functions.
 * Regular Premium clients cannot see or navigate here.
 */
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { Card, CardContent } from "@/components/ui/card.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  Users,
  Trophy,
  ShoppingBag,
  BarChart3,
  Activity,
  Zap,
  MessageSquare,
  Dumbbell,
  LayoutGrid,
} from "lucide-react";
import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { useRoles } from "@/hooks/use-roles.ts";

type PanelItem = { label: string; desc: string; icon: React.ReactNode; to: string };

const OWNER_PANELS: PanelItem[] = [
  { label: "Coaching Panel", desc: "Manage clients & plans", icon: <Users className="w-5 h-5" />, to: "/coach" },
  { label: "Coaching Subscriptions", desc: "View & manage billing", icon: <Trophy className="w-5 h-5" />, to: "/coaching-subscriptions" },
  { label: "Store Orders", desc: "Fulfillment & shipping", icon: <ShoppingBag className="w-5 h-5" />, to: "/store/orders" },
  { label: "Business Analytics", desc: "Revenue & growth metrics", icon: <BarChart3 className="w-5 h-5" />, to: "/bi" },
  { label: "Role Management", desc: "Users, roles & permissions", icon: <Activity className="w-5 h-5" />, to: "/owner" },
  { label: "Store Admin", desc: "Products & inventory", icon: <Zap className="w-5 h-5" />, to: "/store/admin" },
];

const ADMIN_PANELS: PanelItem[] = [
  { label: "Role Management", desc: "Users, roles & permissions", icon: <Activity className="w-5 h-5" />, to: "/owner" },
  { label: "Store Orders", desc: "Fulfillment & shipping", icon: <ShoppingBag className="w-5 h-5" />, to: "/store/orders" },
  { label: "Coaching Subscriptions", desc: "View & manage billing", icon: <Trophy className="w-5 h-5" />, to: "/coaching-subscriptions" },
  { label: "Business Analytics", desc: "Revenue & growth metrics", icon: <BarChart3 className="w-5 h-5" />, to: "/bi" },
  { label: "Coaching Panel", desc: "Manage clients & plans", icon: <Users className="w-5 h-5" />, to: "/coach" },
  { label: "Store Admin", desc: "Products & inventory", icon: <Zap className="w-5 h-5" />, to: "/store/admin" },
];

const COACH_PANELS: PanelItem[] = [
  { label: "Coaching Panel", desc: "Manage clients & plans", icon: <Users className="w-5 h-5" />, to: "/coach" },
  { label: "Coaching Subscriptions", desc: "Client billing", icon: <Trophy className="w-5 h-5" />, to: "/coaching-subscriptions" },
  { label: "Programs", desc: "Build programs", icon: <Dumbbell className="w-5 h-5" />, to: "/programs" },
  { label: "Messages", desc: "Chat with clients", icon: <MessageSquare className="w-5 h-5" />, to: "/messages" },
];

export default function ManagementPage() {
  const { isOwner, isAdmin, isCoach, isLoading } = useRoles();
  const currentUser = useQuery(api.users.getCurrentUser, {});

  if (isLoading || currentUser === undefined) {
    return (
      <div className="max-w-2xl mx-auto px-4 pt-6 space-y-4">
        <Skeleton className="h-12 w-48" />
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      </div>
    );
  }

  // Determine which panels to show based on role
  const panels =
    isOwner ? OWNER_PANELS :
    isAdmin ? ADMIN_PANELS :
    isCoach ? COACH_PANELS :
    null;

  // Regular premium users cannot access this page
  if (!panels) {
    return (
      <div className="max-w-2xl mx-auto px-4 pt-6 text-center py-20">
        <p className="text-muted-foreground">You don{"'"}t have access to this area.</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 pt-6 pb-8 space-y-6">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-yellow-500/15 flex items-center justify-center">
            <LayoutGrid className="w-5 h-5 text-yellow-400" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight">Management</h1>
            <p className="text-xs text-muted-foreground uppercase tracking-wider">
              {isOwner ? "Owner" : isAdmin ? "Admin" : "Coach"} workspace
            </p>
          </div>
        </div>
      </motion.div>

      <motion.div
        className="grid grid-cols-2 gap-3"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.05 }}
      >
        {panels.map((panel, i) => (
          <motion.div
            key={panel.to}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: 0.05 + i * 0.04 }}
          >
            <Link to={panel.to} className="cursor-pointer block group">
              <Card className="border-border bg-card hover:bg-muted/20 hover:border-primary/40 transition-all h-full">
                <CardContent className="p-4 flex flex-col gap-3 min-h-[90px]">
                  <div className="w-8 h-8 rounded bg-muted flex items-center justify-center text-muted-foreground group-hover:text-primary transition-colors">
                    {panel.icon}
                  </div>
                  <div>
                    <p className="font-bold text-sm">{panel.label}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{panel.desc}</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}
