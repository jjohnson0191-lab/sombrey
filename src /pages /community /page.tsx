import { useState } from "react";
import { Authenticated, AuthLoading, Unauthenticated, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { Card, CardContent, CardHeader } from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { SignInButton } from "@/components/ui/signin.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty.tsx";
import {
  Dumbbell,
  Heart,
  MessageCircle,
  Trash2,
  Send,
  Trophy,
  Salad,
  Camera,
  Zap,
  ChevronRight,
  Users,
  Sparkles,
} from "lucide-react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { ConvexError } from "convex/values";
import { useAuth } from "@/hooks/use-auth.ts";
import { cn } from "@/lib/utils.ts";

type PostType = "general" | "achievement" | "workout" | "nutrition" | "progress";

const POST_TYPES: { value: PostType; label: string; icon: React.ReactNode; color: string }[] = [
  { value: "general", label: "General", icon: <Zap className="w-4 h-4" />, color: "bg-primary/10 text-primary" },
  { value: "achievement", label: "Achievement", icon: <Trophy className="w-4 h-4" />, color: "bg-yellow-400/10 text-yellow-400" },
  { value: "workout", label: "Workout", icon: <Dumbbell className="w-4 h-4" />, color: "bg-blue-400/10 text-blue-400" },
  { value: "nutrition", label: "Nutrition", icon: <Salad className="w-4 h-4" />, color: "bg-green-400/10 text-green-400" },
  { value: "progress", label: "Progress", icon: <Camera className="w-4 h-4" />, color: "bg-accent/10 text-accent" },
];

function PostTypeIcon({ type }: { type: PostType }) {
  const t = POST_TYPES.find((p) => p.value === type);
  if (!t) return null;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium", t.color)}>
      {t.icon}
      {t.label}
    </span>
  );
}

function CommentsSection({ postId }: { postId: Id<"communityPosts"> }) {
  const [text, setText] = useState("");
  const comments = useQuery(api.community.listComments, { postId });
  const addComment = useMutation(api.community.addComment);

  const handleSubmit = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    try {
      await addComment({ postId, content: trimmed });
      setText("");
    } catch (e) {
      if (e instanceof ConvexError) {
        toast.error((e.data as { message: string }).message);
      } else {
        toast.error("Failed to add comment");
      }
    }
  };

  return (
    <div className="space-y-3 pt-3 border-t border-border/50">
      {comments === undefined ? (
        <div className="space-y-2">
          {[1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : (
        <div className="space-y-2">
          {comments.map((c) => (
            <div key={c._id} className="flex gap-2 text-sm">
              <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-xs font-bold text-primary">{c.authorName[0]?.toUpperCase()}</span>
              </div>
              <div className="bg-muted/40 rounded-lg px-3 py-1.5 flex-1">
                <span className="font-medium mr-2">{c.authorName}</span>
                <span className="text-muted-foreground">{c.content}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write a comment..."
          className="min-h-[40px] max-h-[80px] text-sm resize-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSubmit();
            }
          }}
        />
        <Button size="icon" onClick={() => void handleSubmit()} disabled={!text.trim()} className="shrink-0 cursor-pointer">
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

function PostCard({ post, currentUserId }: {
  post: {
    _id: Id<"communityPosts">;
    _creationTime: number;
    userId: Id<"users">;
    content: string;
    type: PostType;
    likesCount: number;
    commentsCount: number;
    authorName: string;
    isLiked: boolean;
    workoutData?: { workoutName: string; duration: number; exerciseCount: number };
  };
  currentUserId?: string;
}) {
  const [showComments, setShowComments] = useState(false);
  const toggleLike = useMutation(api.community.toggleLike);
  const deletePost = useMutation(api.community.deletePost);

  const handleLike = async () => {
    try {
      await toggleLike({ postId: post._id });
    } catch {
      toast.error("Failed to update like");
    }
  };

  const handleDelete = async () => {
    try {
      await deletePost({ postId: post._id });
      toast.success("Post deleted");
    } catch {
      toast.error("Failed to delete post");
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
    >
      <Card className="bg-card/50 backdrop-blur border-border">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                <span className="font-bold text-primary">{post.authorName[0]?.toUpperCase()}</span>
              </div>
              <div>
                <p className="font-semibold text-sm">{post.authorName}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(post._creationTime), { addSuffix: true })}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <PostTypeIcon type={post.type} />
              {post.userId === currentUserId && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="w-7 h-7 cursor-pointer text-muted-foreground hover:text-destructive"
                  onClick={() => void handleDelete()}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm leading-relaxed">{post.content}</p>

          {post.workoutData && (
            <div className="flex items-center gap-3 p-3 bg-blue-400/5 border border-blue-400/20 rounded-lg text-sm">
              <Dumbbell className="w-4 h-4 text-blue-400 shrink-0" />
              <div>
                <span className="font-medium">{post.workoutData.workoutName}</span>
                <span className="text-muted-foreground ml-2">
                  · {Math.round(post.workoutData.duration / 60)} min · {post.workoutData.exerciseCount} exercises
                </span>
              </div>
            </div>
          )}

          <div className="flex items-center gap-4 pt-1">
            <button
              onClick={() => void handleLike()}
              className={cn(
                "flex items-center gap-1.5 text-sm transition-colors cursor-pointer",
                post.isLiked ? "text-red-400" : "text-muted-foreground hover:text-red-400"
              )}
            >
              <Heart className={cn("w-4 h-4", post.isLiked && "fill-current")} />
              <span>{post.likesCount}</span>
            </button>
            <button
              onClick={() => setShowComments((v) => !v)}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              <MessageCircle className="w-4 h-4" />
              <span>{post.commentsCount}</span>
            </button>
          </div>

          <AnimatePresence>
            {showComments && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
              >
                <CommentsSection postId={post._id} />
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function CreatePostCard() {
  const [content, setContent] = useState("");
  const [type, setType] = useState<PostType>("general");
  const createPost = useMutation(api.community.createPost);

  const handlePost = async () => {
    const trimmed = content.trim();
    if (!trimmed) return;
    try {
      await createPost({ content: trimmed, type });
      setContent("");
      setType("general");
      toast.success("Posted to community!");
    } catch (e) {
      if (e instanceof ConvexError) {
        toast.error((e.data as { message: string }).message);
      } else {
        toast.error("Failed to create post");
      }
    }
  };

  return (
    <Card className="bg-card/50 backdrop-blur border-border">
      <CardContent className="pt-4 space-y-3">
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Share a workout, achievement, or tip with the community..."
          className="min-h-[80px] resize-none"
        />
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={type} onValueChange={(v) => setType(v as PostType)}>
            <SelectTrigger className="w-36 h-8 text-xs cursor-pointer">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {POST_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value} className="text-xs">
                  <span className="flex items-center gap-1.5">
                    {t.icon} {t.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            onClick={() => void handlePost()}
            disabled={!content.trim()}
            className="ml-auto cursor-pointer"
          >
            <Send className="w-4 h-4 mr-1.5" />
            Post
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CommunityFeed() {
  const { user } = useAuth();
  const currentUser = useQuery(api.users.getCurrentUser, {});
  const { results, status, loadMore } = usePaginatedQuery(
    api.community.listPosts,
    {},
    { initialNumItems: 10 }
  );

  return (
    <div className="space-y-6">
      <CreatePostCard />

      {status === "LoadingFirstPage" ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-36 w-full" />)}
        </div>
      ) : results.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><Users /></EmptyMedia>
            <EmptyTitle>No posts yet</EmptyTitle>
            <EmptyDescription>Be the first to share with the community!</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="space-y-4">
          <AnimatePresence mode="popLayout">
            {results.map((post) => (
              <PostCard
                key={post._id}
                post={post}
                currentUserId={currentUser?._id}
              />
            ))}
          </AnimatePresence>
          {status === "CanLoadMore" && (
            <Button
              variant="secondary"
              className="w-full cursor-pointer"
              onClick={() => loadMore(10)}
            >
              Load More
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export default function CommunityPage() {
  return (
    <div>
      <div className="max-w-2xl mx-auto px-4 pt-6 pb-4">
        {/* Page title */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mb-8"
        >
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Users className="w-6 h-6 text-primary" />
            </div>
            <h1 className="text-3xl font-bold">Community</h1>
            <Badge className="bg-primary/10 text-primary border-0">
              <Sparkles className="w-3 h-3 mr-1" />
              Live Feed
            </Badge>
          </div>
          <p className="text-muted-foreground">
            Share progress, celebrate wins, and inspire each other.
          </p>
        </motion.div>

        <AuthLoading>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-36 w-full" />)}
          </div>
        </AuthLoading>
        <Unauthenticated>
          <div className="text-center py-20 space-y-4">
            <Users className="w-16 h-16 text-primary mx-auto opacity-60" />
            <h2 className="text-2xl font-bold">Join the Community</h2>
            <p className="text-muted-foreground">Sign in to share your progress and connect with others.</p>
            <SignInButton />
          </div>
        </Unauthenticated>
        <Authenticated>
          <CommunityFeed />
        </Authenticated>
      </div>
    </div>
  );
}
