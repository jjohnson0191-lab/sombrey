import { useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "convex/react";
import { Authenticated, Unauthenticated, AuthLoading } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { SignInButton } from "@/components/ui/signin.tsx";
import { ShieldCheck, AlertTriangle, CheckCircle2, Loader2, User, Dumbbell } from "lucide-react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { ConvexError } from "convex/values";

const TIER_LABELS: Record<string, { name: string; price: string; desc: string }> = {
  free:            { name: "Free Account", price: "Free", desc: "Browse and shop the GOAT WALK store." },
  premium:         { name: "GOAT WALK Premium", price: "$9.99/month", desc: "Full AI coaching, workout & nutrition tracking, and analytics." },
  coaching_client: { name: "Personal Coaching", price: "Custom", desc: "1-on-1 coaching with full premium access." },
  // Legacy labels for existing invites
  self_guided:     { name: "Hypertrophic – Self Guided", price: "$4.99/month", desc: "Full access to self-guided training programs." },
  semi_guided:     { name: "Hypertrophic Coach – Semi Guided", price: "$49.98/month", desc: "Semi-guided coaching with program support." },
  full_guided:     { name: "Elite Hypertrophic – Full Guided", price: "$499.98/month", desc: "Fully guided 1-on-1 coaching experience." },
};

function AcceptInnerPage({ token }: { token: string }) {
  const invite = useQuery(api.invites.getInviteByToken, { token });
  const acceptInvite = useMutation(api.invites.acceptInvite);
  const navigate = useNavigate();
  const [accepting, setAccepting] = useState(false);
  const [done, setDone] = useState(false);

  if (invite === undefined) {
    return (
      <div className="space-y-4 w-full max-w-sm">
        <Skeleton className="h-16 w-16 rounded-full mx-auto" />
        <Skeleton className="h-8 w-48 mx-auto" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (invite === null) {
    return (
      <div className="text-center max-w-sm">
        <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="w-8 h-8 text-destructive" />
        </div>
        <h2 className="text-xl font-bold mb-2">Invalid Invite</h2>
        <p className="text-muted-foreground text-sm">
          This invite link is not valid or does not exist. Please contact the owner for a new invite.
        </p>
      </div>
    );
  }

  if (invite.status === "expired") {
    return (
      <div className="text-center max-w-sm">
        <div className="w-16 h-16 rounded-full bg-yellow-500/10 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="w-8 h-8 text-yellow-400" />
        </div>
        <h2 className="text-xl font-bold mb-2">Invite Expired</h2>
        <p className="text-muted-foreground text-sm">
          This invite link has expired. Please ask the owner to send a new invite.
        </p>
      </div>
    );
  }

  if (invite.status === "accepted") {
    return (
      <div className="text-center max-w-sm">
        <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 className="w-8 h-8 text-green-400" />
        </div>
        <h2 className="text-xl font-bold mb-2">Already Accepted</h2>
        <p className="text-muted-foreground text-sm mb-6">
          This invite has already been used. Head to your dashboard.
        </p>
        <Button className="cursor-pointer" onClick={() => navigate("/")}>
          Go to Dashboard
        </Button>
      </div>
    );
  }

  const isClientInvite = invite.inviteType === "client";
  const tier = isClientInvite && invite.subscriptionTier
    ? TIER_LABELS[invite.subscriptionTier]
    : null;

  if (done) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="text-center max-w-sm"
      >
        <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 className="w-8 h-8 text-green-400" />
        </div>
        {isClientInvite ? (
          <>
            <h2 className="text-2xl font-bold mb-2">Welcome to GOAT WALK!</h2>
            <p className="text-muted-foreground text-sm mb-2">
              Your account is ready and your subscription has been activated.
            </p>
            {tier && (
              <div className="bg-muted/40 border border-border rounded-xl px-4 py-3 mb-6 text-left">
                <p className="text-xs text-muted-foreground mb-1">Active Plan</p>
                <p className="font-semibold text-sm">{tier.name}</p>
                <p className="text-xs text-primary font-medium">{tier.price}</p>
              </div>
            )}
            <Button className="w-full cursor-pointer" onClick={() => navigate("/")}>
              Go to Dashboard
            </Button>
          </>
        ) : (
          <>
            <h2 className="text-2xl font-bold mb-2">Welcome, Coach!</h2>
            <p className="text-muted-foreground text-sm mb-6">
              Your Coach role has been activated. You now have access to the GOAT WALK Coach Dashboard.
            </p>
            <Button className="cursor-pointer" onClick={() => navigate("/coach")}>
              Go to Coach Dashboard
            </Button>
          </>
        )}
      </motion.div>
    );
  }

  const handleAccept = async () => {
    setAccepting(true);
    try {
      await acceptInvite({ token });
      setDone(true);
    } catch (err) {
      if (err instanceof ConvexError) {
        const data = err.data as { message?: string };
        toast.error(data.message ?? "Failed to accept invite");
      } else {
        toast.error("Something went wrong. Please try again.");
      }
    } finally {
      setAccepting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="text-center max-w-sm w-full"
    >
      <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
        {isClientInvite
          ? <User className="w-8 h-8 text-primary" />
          : <ShieldCheck className="w-8 h-8 text-primary" />
        }
      </div>
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
        {isClientInvite ? "Client Invitation" : "Coach Invitation"}
      </p>
      <h2 className="text-2xl font-bold mb-2">
        {isClientInvite ? "You're Invited to GOAT WALK" : "You're Invited to Coach"}
      </h2>

      <p className="text-muted-foreground text-sm mb-1">This invite was sent to:</p>
      <p className="font-semibold text-sm mb-5 bg-muted/40 px-4 py-2 rounded-lg inline-block">
        {invite.email}
      </p>

      {/* Client-specific: show tier */}
      {isClientInvite && tier && (
        <div className="bg-muted/40 border border-border rounded-xl px-4 py-3 mb-5 text-left">
          <div className="flex items-center gap-2 mb-1">
            <Dumbbell className="w-4 h-4 text-primary shrink-0" />
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Pre-Assigned Plan</p>
          </div>
          <p className="font-bold text-sm">{tier.name}</p>
          <p className="text-xs text-primary font-semibold mt-0.5">{tier.price}</p>
          <p className="text-xs text-muted-foreground mt-1">{tier.desc}</p>
        </div>
      )}

      <p className="text-muted-foreground text-sm mb-8">
        {isClientInvite
          ? "Accepting this invite will create your account and activate your subscription plan above."
          : "Accepting will grant you the Coach role on GOAT WALK, giving you access to the coach dashboard, clients, and programs."
        }
      </p>

      <Button
        className="w-full cursor-pointer"
        onClick={() => void handleAccept()}
        disabled={accepting}
      >
        {accepting ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Accepting…
          </>
        ) : isClientInvite ? (
          "Accept Invite & Get Started"
        ) : (
          "Accept Invite & Become a Coach"
        )}
      </Button>
    </motion.div>
  );
}

export default function InviteAcceptPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-8 h-8 text-destructive" />
          </div>
          <h2 className="text-xl font-bold mb-2">Missing Invite Token</h2>
          <p className="text-muted-foreground text-sm">
            No invite token found in this link. Please use the full link from your invitation email.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12 bg-background">
      <div className="mb-8 text-center">
        <p className="text-xs font-semibold tracking-[4px] uppercase text-muted-foreground">
          GOAT WALK
        </p>
      </div>

      <AuthLoading>
        <div className="space-y-4 w-full max-w-sm">
          <Skeleton className="h-16 w-16 rounded-full mx-auto" />
          <Skeleton className="h-8 w-48 mx-auto" />
          <Skeleton className="h-12 w-full" />
        </div>
      </AuthLoading>

      <Unauthenticated>
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center max-w-sm w-full"
        >
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <ShieldCheck className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-2xl font-bold mb-2">GOAT WALK Invitation</h2>
          <p className="text-muted-foreground text-sm mb-8">
            Sign in or create an account to accept your invitation and access GOAT WALK.
          </p>
          <div className="flex justify-center">
            <SignInButton />
          </div>
        </motion.div>
      </Unauthenticated>

      <Authenticated>
        <AcceptInnerPage token={token} />
      </Authenticated>
    </div>
  );
}
