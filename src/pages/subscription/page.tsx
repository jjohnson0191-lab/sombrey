import { useState, useEffect } from "react";
import { Authenticated, useQuery, useAction, useMutation } from "convex/react";
import { useNavigate } from "react-router-dom";
import { api } from "@/convex/_generated/api.js";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  CheckCircle2,
  Zap,
  Star,
  CreditCard,
  ArrowRight,
  Lock,
  Crown,
} from "lucide-react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { cn } from "@/lib/utils.ts";

// ─── Constants ────────────────────────────────────────────────────────────────

const PREMIUM_VARIANT_ID = "var_goatwalk_premium_monthly";

type TierKey = "free" | "premium" | "coaching_client" | "self_guided" | "semi_guided" | "full_guided";

const FREE_FEATURES = [
  "GOAT WALK store & exclusive drops",
  "Community access",
  "Blogs & articles",
  "Vlogs & training content",
] as const;

const PREMIUM_FEATURES = [
  "AI personal coach",
  "AI workout creation",
  "AI macro suggestions",
  "Meal logging & nutrition tracking",
  "Camera AI Macro Calculator",
  "Workout tracking & logging",
  "Exercise performance tracking",
  "Progress photos",
  "Training calendar",
  "Training analytics & insights",
] as const;

// ─── Tier Card ────────────────────────────────────────────────────────────────

function FreeCard({ isActive }: { isActive: boolean }) {
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="h-full">
      <Card className={cn(
        "h-full flex flex-col relative overflow-hidden transition-all duration-300 bg-card/50 backdrop-blur border-border",
        isActive && "ring-2 ring-green-500/50"
      )}>
        {isActive && (
          <div className="absolute top-3 left-3">
            <Badge variant="secondary" className="text-[10px] bg-green-500/20 text-green-400 border-green-500/30">
              CURRENT PLAN
            </Badge>
          </div>
        )}
        <CardHeader className={cn("pb-4", isActive && "pt-10")}>
          <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3 bg-muted/40">
            <Star className="w-5 h-5 text-muted-foreground" />
          </div>
          <CardTitle className="text-xl">Free</CardTitle>
          <div className="text-sm text-muted-foreground">Shopping & Community</div>
          <div className="pt-2 flex items-baseline gap-1">
            <span className="text-4xl font-bold">$0</span>
          </div>
          <CardDescription>Browse the store and join the GOAT WALK community</CardDescription>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col gap-6">
          <ul className="space-y-2.5 flex-1">
            {FREE_FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <span className="text-sm">{f}</span>
              </li>
            ))}
          </ul>
          <Button variant="secondary" disabled className="w-full opacity-60">
            {isActive ? "Current Plan" : "Free Plan"}
          </Button>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function PremiumCard({
  isActive,
  onUpgrade,
  loading,
  isCoachingClient,
  isAdminGranted,
  isStaffUser,
}: {
  isActive: boolean;
  onUpgrade: () => void;
  loading: boolean;
  isCoachingClient: boolean;
  isAdminGranted: boolean;
  isStaffUser: boolean;
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="h-full">
      <Card className={cn(
        "h-full flex flex-col relative overflow-hidden transition-all duration-300 border-primary border-2 bg-primary/5",
        isActive && "ring-2 ring-green-500/50"
      )}>
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-primary/0 via-primary to-primary/0" />
        <div className="absolute top-3 right-3">
          <Badge className="bg-primary text-primary-foreground text-[10px] font-bold">
            MOST POPULAR
          </Badge>
        </div>
        {isActive && (
          <div className="absolute top-3 left-3">
            <Badge variant="secondary" className="text-[10px] bg-green-500/20 text-green-400 border-green-500/30">
              {isCoachingClient ? "INCLUDED IN COACHING" : "CURRENT PLAN"}
            </Badge>
          </div>
        )}
        <CardHeader className="pb-4 pt-10">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3 bg-primary/10">
            <Zap className="w-5 h-5 text-primary" />
          </div>
          <CardTitle className="text-xl">GOAT WALK Premium</CardTitle>
          <div className="text-sm text-muted-foreground">Full Access</div>
          <div className="pt-2 flex items-baseline gap-1">
            <span className="text-4xl font-bold">$9.99</span>
            <span className="text-muted-foreground text-sm">/month</span>
          </div>
          <CardDescription>Everything you need to transform your physique with AI-powered tools</CardDescription>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col gap-6">
          <ul className="space-y-2.5 flex-1">
            {PREMIUM_FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <span className="text-sm">{f}</span>
              </li>
            ))}
          </ul>
          {isActive ? (
            <Button variant="secondary" disabled className="w-full">
              <CheckCircle2 className="w-4 h-4 mr-2" />
              {isCoachingClient ? "Included in Your Plan" : isAdminGranted ? "Admin Granted" : "Current Plan"}
            </Button>
          ) : (
            <Button
              className="w-full cursor-pointer shadow-lg"
              onClick={onUpgrade}
              disabled={loading}
            >
              {loading ? (
                "Activating..."
              ) : isStaffUser ? (
                <>
                  Activate Free <ArrowRight className="w-4 h-4 ml-2" />
                </>
              ) : (
                <>
                  Get Premium <ArrowRight className="w-4 h-4 ml-2" />
                </>
              )}
            </Button>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ─── Page Content ─────────────────────────────────────────────────────────────

function SubscriptionContent() {
  const [loading, setLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [hasPremium, setHasPremium] = useState<boolean | null>(null);
  const navigate = useNavigate();

  const currentUser = useQuery(api.users.getCurrentUser, {});
  const checkoutAction = useAction(api.commerce.subscriptions.checkout);
  const getBillingPortal = useAction(api.commerce.subscriptions.getBillingPortalUrl);
  const checkPremium = useAction(api.commerce.subscriptions.checkPremiumAccess);
  const syncSubscription = useAction(api.commerce.subscriptions.syncSubscriptionStatus);
  const grantPremiumAccess = useMutation(api.users.grantPremiumAccess);

  const tier = currentUser?.subscriptionTier as TierKey | undefined;
  const isCoachingClient = tier === "coaching_client" || tier === "semi_guided" || tier === "full_guided";
  const isAdminGranted = (currentUser as { adminGrantedPremium?: boolean } | null | undefined)?.adminGrantedPremium === true;
  // Owner/admin can self-activate premium without Stripe
  const isStaffUser = currentUser?.primaryRole === "owner" || currentUser?.primaryRole === "admin";

  useEffect(() => {
    if (currentUser === undefined) return;
    if (!currentUser) {
      setHasPremium(false);
      return;
    }

    // Admin-granted premium bypasses Commerce
    if (isAdminGranted) {
      setHasPremium(true);
      return;
    }

    // Coaching clients always have premium access
    if (isCoachingClient) {
      setHasPremium(true);
      return;
    }

    const check = async () => {
      // #16 — If returning from a successful checkout (new tab may have redirected
      // to /onboarding, but the original tab may be back at /subscription),
      // sync the subscription tier to the DB first so the check reflects the
      // live Commerce state.
      const params = new URLSearchParams(window.location.search);
      if (params.get("success") === "1") {
        try {
          await syncSubscription({});
        } catch { /* non-fatal */ }
        const url = new URL(window.location.href);
        url.searchParams.delete("success");
        window.history.replaceState({}, "", url.toString());
      }
      try {
        const result = await checkPremium({});
        setHasPremium(result.hasAccess);
      } catch {
        setHasPremium(false);
      }
    };
    void check();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.customerId, isCoachingClient, isAdminGranted]);

  const handleUpgrade = async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      // Owner and admin self-activate premium without Stripe
      if (isStaffUser) {
        await grantPremiumAccess({ userId: currentUser._id });
        toast.success("GOAT WALK Premium activated!");
        navigate("/onboarding");
        return;
      }

      const result = await checkoutAction({
        variantId: PREMIUM_VARIANT_ID,
        successUrl: window.location.origin + "/onboarding",
        cancelUrl: window.location.href,
      });
      if (result.url) {
        window.open(result.url, "_blank");
      } else {
        toast.success("Plan updated!");
      }
    } catch {
      toast.error("Failed to activate premium. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleBillingPortal = async () => {
    setPortalLoading(true);
    try {
      const { url } = await getBillingPortal({ returnUrl: window.location.href });
      window.open(url, "_blank");
    } catch {
      toast.error("Could not open billing portal");
    } finally {
      setPortalLoading(false);
    }
  };

  const isLoading = currentUser === undefined || (hasPremium === null && !isAdminGranted && !isCoachingClient);

  if (isLoading) {
    return (
      <div className="space-y-8">
        <div className="space-y-2">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-5 w-80" />
        </div>
        <div className="grid md:grid-cols-2 gap-6 max-w-3xl mx-auto">
          <Skeleton className="h-[520px] w-full" />
          <Skeleton className="h-[520px] w-full" />
        </div>
      </div>
    );
  }

  const isPremiumActive = hasPremium === true;

  return (
    <div className="space-y-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="text-4xl font-bold mb-2">
          Choose Your <span className="text-primary">Plan</span>
        </h1>
        <p className="text-muted-foreground text-lg">
          Unlock AI-powered training, nutrition, and analytics tools
        </p>
      </motion.div>

      {/* Active plan banner */}
      {isPremiumActive && (
        <motion.div
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex items-center justify-between p-4 bg-primary/10 border border-primary/30 rounded-xl"
        >
          <div className="flex items-center gap-3">
            <Crown className="w-5 h-5 text-primary" />
            <div>
              <p className="font-semibold text-sm flex items-center gap-2">
                {isCoachingClient ? "Personal Coaching Plan" : "GOAT WALK Premium"}
                {isAdminGranted && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-primary/20 text-primary border border-primary/30">
                    Admin Granted
                  </span>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {isAdminGranted
                  ? "Premium access activated by admin — no payment required"
                  : isCoachingClient
                    ? "You have full premium access included in your coaching plan"
                    : "Manage billing, invoices, and payment methods"}
              </p>
            </div>
          </div>
          {!isCoachingClient && !isAdminGranted && (
            <Button
              variant="secondary"
              size="sm"
              className="cursor-pointer"
              onClick={handleBillingPortal}
              disabled={portalLoading}
            >
              <CreditCard className="w-4 h-4 mr-2" />
              {portalLoading ? "Loading..." : "Billing Portal"}
            </Button>
          )}
        </motion.div>
      )}

      {/* Plan cards */}
      <div className="grid md:grid-cols-2 gap-6 max-w-3xl mx-auto">
        <FreeCard isActive={!isPremiumActive} />
        <PremiumCard
          isActive={isPremiumActive}
          isCoachingClient={isCoachingClient}
          isAdminGranted={isAdminGranted}
          isStaffUser={isStaffUser}
          onUpgrade={handleUpgrade}
          loading={loading}
        />
      </div>

      {/* Security note */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="flex items-center justify-center gap-2 text-sm text-muted-foreground"
      >
        <Lock className="w-4 h-4" />
        <span>
          {isStaffUser
            ? "Owner/admin accounts can activate premium without payment."
            : "Secure checkout powered by Stripe. Cancel anytime."}
        </span>
      </motion.div>
    </div>
  );
}

export default function SubscriptionPage() {
  return (
    <Authenticated>
      <div className="max-w-4xl mx-auto px-4 pt-6 pb-8">
        <SubscriptionContent />
      </div>
    </Authenticated>
  );
}
