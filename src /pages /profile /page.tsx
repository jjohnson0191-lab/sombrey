import { Authenticated, AuthLoading, Unauthenticated, useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { SignInButton } from "@/components/ui/signin.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { useAuth } from "@/hooks/use-auth.ts";
import {
  User, CreditCard, Bell, LogOut, ChevronRight, Shield, Camera, Trash2,
  Loader2, FileText, AlertTriangle, X, MessageSquare,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useState, useRef } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils.ts";
import AvatarCropModal from "@/components/avatar-crop-modal.tsx";

// ─── Avatar Section ────────────────────────────────────────────────────────────

function AvatarSection({ avatarUrl, displayName }: { avatarUrl: string | null | undefined; displayName: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [cropSrc, setCropSrc] = useState<string | null>(null);

  const generateUploadUrl = useMutation(api.users.generateAvatarUploadUrl);
  const saveAvatar = useMutation(api.users.saveAvatar);
  const removeAvatar = useMutation(api.users.removeAvatar);

  const currentAvatar = localPreview ?? avatarUrl ?? null;

  const handleCroppedFile = async (file: File) => {
    setCropSrc(null);
    setLocalPreview(URL.createObjectURL(file));
    setUploading(true);
    try {
      const uploadUrl = await generateUploadUrl();
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!res.ok) throw new Error("Upload failed");
      const { storageId } = await res.json() as { storageId: string };
      await saveAvatar({ storageId: storageId as Parameters<typeof saveAvatar>[0]["storageId"] });
      toast.success("Profile photo updated.");
    } catch {
      toast.error("Photo upload failed. Please try again.");
      setLocalPreview(null);
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async () => {
    try {
      await removeAvatar({});
      setLocalPreview(null);
      toast.success("Profile photo removed.");
    } catch {
      toast.error("Failed to remove photo. Please try again.");
    }
  };

  return (
    <>
      <div className="flex items-center gap-5">
        <div className="relative shrink-0">
          <div
            onClick={() => !uploading && inputRef.current?.click()}
            className={cn(
              "w-20 h-20 rounded-full overflow-hidden bg-muted flex items-center justify-center border-2 border-border transition-opacity cursor-pointer group relative",
              uploading && "cursor-wait"
            )}
          >
            {currentAvatar ? (
              <img src={currentAvatar} alt={displayName} className="w-full h-full object-cover" />
            ) : (
              <span className="text-3xl font-black text-muted-foreground">{displayName[0]?.toUpperCase()}</span>
            )}
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-full">
              {uploading ? <Loader2 className="w-5 h-5 text-white animate-spin" /> : <Camera className="w-5 h-5 text-white" />}
            </div>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) setCropSrc(URL.createObjectURL(file));
              e.target.value = "";
            }}
          />
        </div>

        <div className="flex-1 min-w-0 space-y-1">
          <p className="text-xs text-muted-foreground">Profile photo</p>
          <div className="flex gap-2 flex-wrap">
            <Button
              size="sm"
              variant="secondary"
              className="cursor-pointer gap-1.5 text-xs h-7"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
            >
              <Camera className="w-3 h-3" />
              {currentAvatar ? "Change" : "Upload"}
            </Button>
            {currentAvatar && (
              <Button
                size="sm"
                variant="secondary"
                className="cursor-pointer gap-1.5 text-xs h-7 text-destructive hover:text-destructive"
                onClick={() => void handleRemove()}
                disabled={uploading}
              >
                <Trash2 className="w-3 h-3" />
                Remove
              </Button>
            )}
          </div>
        </div>
      </div>

      {cropSrc && (
        <AvatarCropModal
          open={!!cropSrc}
          imageSrc={cropSrc}
          onConfirm={(file) => void handleCroppedFile(file)}
          onCancel={() => setCropSrc(null)}
        />
      )}
    </>
  );
}

// ─── Sign Out Confirmation Dialog ─────────────────────────────────────────────

function SignOutDialog({ onClose }: { onClose: () => void }) {
  const { removeUser } = useAuth();
  const [loading, setLoading] = useState(false);

  const handleSignOut = async () => {
    setLoading(true);
    try {
      await removeUser();
    } catch {
      toast.error("Failed to sign out. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl w-full max-w-sm p-6 space-y-4 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center shrink-0">
              <LogOut className="w-5 h-5 text-muted-foreground" />
            </div>
            <div>
              <h3 className="font-bold text-base">Sign Out</h3>
              <p className="text-sm text-muted-foreground">Are you sure you want to sign out?</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer mt-0.5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex gap-2 pt-1">
          <Button
            variant="secondary"
            className="flex-1 cursor-pointer"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            className="flex-1 cursor-pointer"
            onClick={() => void handleSignOut()}
            disabled={loading}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4 mr-1.5" />}
            Sign Out
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Delete Account Dialog ────────────────────────────────────────────────────

function DeleteAccountDialog({ onClose }: { onClose: () => void }) {
  const { removeUser } = useAuth();
  const deleteSelf = useMutation(api.users.deleteSelfAccount);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    if (!confirmed) return;
    setLoading(true);
    try {
      await deleteSelf({});
      toast.success("Account deleted successfully.");
      await removeUser();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to delete account.";
      if (msg.includes("Owner account")) {
        toast.error("Owner accounts cannot be self-deleted. Please contact support.");
      } else {
        toast.error("We couldn't delete your account right now. Please try again.");
      }
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-card border border-destructive/30 rounded-2xl w-full max-w-sm p-6 space-y-4 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-destructive/15 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5 text-destructive" />
          </div>
          <div>
            <h3 className="font-bold text-base text-destructive">Delete Account</h3>
            <p className="text-sm text-muted-foreground mt-1">This is permanent and cannot be undone. The following data will be deleted:</p>
          </div>
        </div>

        <div className="bg-destructive/5 border border-destructive/20 rounded-xl p-4">
          <ul className="text-xs text-muted-foreground space-y-1.5">
            {[
              "Profile and account information",
              "All workout logs and progress data",
              "Progress photos and check-ins",
              "AI-generated plans and nutrition plans",
              "Community posts and messages",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2">
                <span className="text-destructive font-bold mt-0.5">×</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-muted-foreground">
          If you have an active subscription, please cancel it in Profile → My Subscription before deleting your account.
        </p>

        {/* Confirm checkbox */}
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-0.5 cursor-pointer"
          />
          <span className="text-sm text-foreground">I understand this is permanent and cannot be undone</span>
        </label>

        <div className="flex gap-2">
          <Button
            variant="secondary"
            className="flex-1 cursor-pointer"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            className="flex-1 cursor-pointer"
            onClick={() => void handleDelete()}
            disabled={!confirmed || loading}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4 mr-1.5" />}
            Delete Account
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Profile Content ──────────────────────────────────────────────────────────

function ProfileContent() {
  const currentUser = useQuery(api.users.getCurrentUser, {});
  const updateProfile = useMutation(api.users.updateProfile);
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [editing, setEditing] = useState(false);
  const [showSignOut, setShowSignOut] = useState(false);
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);

  const displayName = currentUser?.name || user?.profile.name || "Athlete";
  const email = currentUser?.email || user?.profile.email;

  const handleSave = async () => {
    if (!name.trim()) return;
    try {
      await updateProfile({ name: name.trim() });
      toast.success("Profile updated");
      setEditing(false);
    } catch {
      toast.error("Failed to update profile. Please try again.");
    }
  };

  if (currentUser === undefined) {
    return (
      <div className="space-y-4 px-4 pt-6">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const MENU_ITEMS = [
    { label: "My Subscription", desc: "Manage your plan", icon: CreditCard, to: "/subscription" as string | null },
    { label: "Notifications", desc: "Push & email settings", icon: Bell, to: null },
  ];

  return (
    <div className="max-w-2xl mx-auto px-4 pt-6 pb-4 space-y-6">
      {/* Dialogs */}
      {showSignOut && <SignOutDialog onClose={() => setShowSignOut(false)} />}
      {showDeleteAccount && <DeleteAccountDialog onClose={() => setShowDeleteAccount(false)} />}

      <div>
        <p className="text-muted-foreground text-sm uppercase tracking-widest mb-0.5">Account</p>
        <h1 className="text-3xl font-black tracking-tight">Profile</h1>
      </div>

      {/* Avatar + name card */}
      <Card className="border-border bg-card">
        <CardContent className="p-5 space-y-5">
          <AvatarSection avatarUrl={currentUser?.avatarUrl} displayName={displayName} />
          <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
            <div className="flex-1 min-w-0">
              <p className="font-black text-base truncate">{displayName}</p>
              {email && <p className="text-sm text-muted-foreground truncate">{email}</p>}
              <Badge variant="secondary" className="mt-1 text-[10px] capitalize">
                {currentUser?.primaryRole ?? "client"}
              </Badge>
            </div>
            <Button variant="ghost" size="sm" className="cursor-pointer shrink-0" onClick={() => { setName(displayName); setEditing(true); }}>
              Edit Name
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Edit name form */}
      {editing && (
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-base">Edit Name</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Display Name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
            </div>
            <div className="flex gap-2">
              <Button onClick={() => void handleSave()} className="cursor-pointer">Save</Button>
              <Button variant="secondary" onClick={() => setEditing(false)} className="cursor-pointer">Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Menu items */}
      <Card className="border-border bg-card divide-y divide-border">
        {MENU_ITEMS.map(({ label, desc, icon: Icon, to }) =>
          to ? (
            <Link key={label} to={to} className="flex items-center gap-3 px-5 py-4 hover:bg-muted/20 transition-colors cursor-pointer group">
              <div className="w-8 h-8 rounded bg-muted flex items-center justify-center shrink-0">
                <Icon className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">{label}</p>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
            </Link>
          ) : (
            <div key={label} className="flex items-center gap-3 px-5 py-4 opacity-50">
              <div className="w-8 h-8 rounded bg-muted flex items-center justify-center shrink-0">
                <Icon className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">{label}</p>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
              <Badge variant="secondary" className="text-[10px]">Soon</Badge>
            </div>
          )
        )}
      </Card>

      {/* Legal links */}
      <Card className="border-border bg-card divide-y divide-border">
        <Link to="/contact-support" className="flex items-center gap-3 px-5 py-4 hover:bg-muted/20 transition-colors cursor-pointer group">
          <div className="w-8 h-8 rounded bg-muted flex items-center justify-center shrink-0">
            <MessageSquare className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm">Contact Support</p>
            <p className="text-xs text-muted-foreground">Submit a support request</p>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
        </Link>
        <Link to="/privacy-policy" className="flex items-center gap-3 px-5 py-4 hover:bg-muted/20 transition-colors cursor-pointer group">
          <div className="w-8 h-8 rounded bg-muted flex items-center justify-center shrink-0">
            <Shield className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm">Privacy Policy</p>
            <p className="text-xs text-muted-foreground">How we handle your data</p>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
        </Link>
        <Link to="/terms" className="flex items-center gap-3 px-5 py-4 hover:bg-muted/20 transition-colors cursor-pointer group">
          <div className="w-8 h-8 rounded bg-muted flex items-center justify-center shrink-0">
            <FileText className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm">Terms of Service</p>
            <p className="text-xs text-muted-foreground">Usage terms and conditions</p>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
        </Link>
      </Card>

      {/* Sign out */}
      <Button
        variant="secondary"
        className="w-full cursor-pointer"
        onClick={() => setShowSignOut(true)}
      >
        <LogOut className="w-4 h-4 mr-2" />
        Sign Out
      </Button>

      {/* Delete account */}
      <div className="border-t border-border pt-4">
        <button
          type="button"
          onClick={() => setShowDeleteAccount(true)}
          className="w-full text-xs text-destructive/70 hover:text-destructive transition-colors cursor-pointer py-2 flex items-center justify-center gap-1.5"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Delete Account
        </button>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <>
      <AuthLoading>
        <div className="space-y-4 px-4 pt-6 max-w-2xl mx-auto">
          <Skeleton className="h-16 w-48" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </AuthLoading>
      <Unauthenticated>
        <div className="text-center py-20 px-4 space-y-4">
          <User className="w-12 h-12 mx-auto text-muted-foreground" />
          <h2 className="text-2xl font-black">Sign in to view profile</h2>
          <SignInButton />
        </div>
      </Unauthenticated>
      <Authenticated>
        <ProfileContent />
      </Authenticated>
    </>
  );
}
