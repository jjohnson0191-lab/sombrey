import { useState } from "react";
import { useAction, useQuery, useMutation } from "convex/react";
import { Authenticated, Unauthenticated, AuthLoading } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { SignInButton } from "@/components/ui/signin.tsx";
import { ShoppingBag, Lock, Package, Settings, ShoppingCart } from "lucide-react";
import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { toast } from "sonner";
import { cn } from "@/lib/utils.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CATEGORIES = ["All", "Apparel", "Accessories"] as const;
type Category = (typeof CATEGORIES)[number];

function formatPrice(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

// ─── Product Card ─────────────────────────────────────────────────────────────

function getPublicStockStatus(product: Doc<"storeProducts">): "available" | "low" | "out_of_stock" {
  if (product.stockQuantity === undefined || product.stockQuantity === null) return "available";
  const threshold = product.lowStockThreshold ?? 5;
  if (product.stockQuantity <= 0) return "out_of_stock";
  if (product.stockQuantity <= threshold) return "low";
  return "available";
}

function ProductCard({ product }: { product: Doc<"storeProducts"> }) {
  const [selectedVariant, setSelectedVariant] = useState(product.variants[0]);
  const [loading, setLoading] = useState(false);
  const [cartLoading, setCartLoading] = useState(false);
  const checkoutAction = useAction(api.commerce.subscriptions.checkout);
  const addToCart = useMutation(api.cart.addToCart);
  const stockStatus = getPublicStockStatus(product);
  const isOutOfStock = stockStatus === "out_of_stock";

  const handleBuy = async () => {
    if (!selectedVariant || isOutOfStock) return;
    setLoading(true);
    try {
      const result = await checkoutAction({
        variantId: selectedVariant.id,
        successUrl: window.location.origin + "/store?success=1",
        cancelUrl: window.location.href,
      });
      if (result.url) {
        window.open(result.url, "_blank");
      }
    } catch {
      toast.error("Could not open checkout. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleAddToCart = async () => {
    if (!selectedVariant || isOutOfStock) return;
    setCartLoading(true);
    try {
      await addToCart({ productId: product._id, variantId: selectedVariant.id });
      toast.success(`${product.name} added to cart!`, {
        action: { label: "View Cart", onClick: () => window.location.assign("/store/cart") },
      });
    } catch (err) {
      if (err instanceof Error) toast.error(err.message);
      else toast.error("Could not add to cart.");
    } finally {
      setCartLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={isOutOfStock ? {} : { y: -4 }}
      transition={{ duration: 0.3 }}
      className={cn("group flex flex-col bg-card border border-border rounded-2xl overflow-hidden", isOutOfStock && "opacity-70")}
    >
      {/* Image */}
      <div className="relative aspect-square overflow-hidden bg-muted">
        <img
          src={product.imageUrl}
          alt={product.name}
          className={cn("w-full h-full object-cover object-top transition-transform duration-500", !isOutOfStock && "group-hover:scale-105", isOutOfStock && "grayscale")}
        />
        {product.badge && !isOutOfStock && (
          <div className="absolute top-3 left-3">
            <Badge className="bg-foreground text-background text-[10px] font-bold uppercase tracking-widest">
              {product.badge}
            </Badge>
          </div>
        )}
        {isOutOfStock && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="bg-background/90 backdrop-blur rounded-xl px-4 py-2 text-sm font-bold uppercase tracking-widest">
              Out of Stock
            </div>
          </div>
        )}
        {stockStatus === "low" && !isOutOfStock && (
          <div className="absolute bottom-3 left-3">
            <Badge className="bg-yellow-500 text-white text-[10px] font-bold">
              Only {product.stockQuantity} left!
            </Badge>
          </div>
        )}
        <div className="absolute top-3 right-3">
          <Badge variant="secondary" className="text-[10px] font-medium bg-background/80 backdrop-blur">
            {product.category}
          </Badge>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-col flex-1 p-5 gap-4">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-widest mb-1">GOAT WALK</p>
          <h3 className="text-lg font-bold leading-tight">{product.name}</h3>
          <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{product.description}</p>
        </div>

        {/* Variant selector */}
        {!isOutOfStock && (
          <div>
            <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wider">
              {product.variants.length > 2 ? "Size" : "Option"}
            </p>
            <div className="flex flex-wrap gap-2">
              {product.variants.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setSelectedVariant(v)}
                  className={cn(
                    "px-3 py-1.5 text-sm font-medium rounded-lg border transition-all cursor-pointer",
                    selectedVariant?.id === v.id
                      ? "bg-foreground text-background border-foreground"
                      : "bg-transparent text-foreground border-border hover:border-foreground/50"
                  )}
                >
                  {v.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Price + CTAs */}
        <div className="mt-auto pt-2 border-t border-border space-y-2">
          <span className="text-2xl font-bold block">
            {selectedVariant ? formatPrice(selectedVariant.price) : "—"}
          </span>
          {isOutOfStock ? (
            <Button size="sm" disabled className="w-full gap-2 opacity-60">
              <ShoppingBag className="w-4 h-4" />
              Out of Stock
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                className="cursor-pointer gap-2 flex-1"
                onClick={handleAddToCart}
                disabled={cartLoading || !selectedVariant}
              >
                <ShoppingCart className="w-4 h-4" />
                {cartLoading ? "Adding..." : "Add to Cart"}
              </Button>
              <Button
                size="sm"
                className="cursor-pointer gap-2 flex-1"
                onClick={handleBuy}
                disabled={loading || !selectedVariant}
              >
                <ShoppingBag className="w-4 h-4" />
                {loading ? "..." : "Buy Now"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ─── Store Content ────────────────────────────────────────────────────────────

function StoreContent() {
  const [activeCategory, setActiveCategory] = useState<Category>("All");
  const products = useQuery(api.store.listActive, {});
  const currentUser = useQuery(api.users.getCurrentUser, {});
  const isAdmin = (currentUser?.effectiveRoles as string[] | undefined)?.some(r => ["admin", "store_manager", "owner"].includes(r)) ?? false;

  const filtered = products
    ? activeCategory === "All"
      ? products
      : products.filter((p) => p.category === activeCategory)
    : [];

  const isLoading = products === undefined;

  return (
    <div className="px-4 pt-6 pb-8 max-w-3xl mx-auto space-y-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-widest mb-1">Official Merch</p>
            <h1 className="text-4xl font-black tracking-tight">GOAT WALK<br />Store</h1>
            <p className="text-muted-foreground mt-2">Premium training gear. Built for the walk.</p>
          </div>
          <div className="flex items-center gap-2 shrink-0 mt-1">
            {isAdmin && (
              <Link to="/store/admin">
                <Button size="sm" variant="secondary" className="cursor-pointer gap-2">
                  <Settings className="w-4 h-4" />
                  Manage
                </Button>
              </Link>
            )}
            <Link to="/store/cart">
              <Button size="sm" variant="secondary" className="cursor-pointer gap-2">
                <ShoppingCart className="w-4 h-4" />
                Cart
              </Button>
            </Link>
          </div>
        </div>
      </motion.div>

      {/* Category Filter */}
      <div className="flex gap-2 flex-wrap">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={cn(
              "px-4 py-1.5 rounded-full text-sm font-medium border transition-all cursor-pointer",
              activeCategory === cat
                ? "bg-foreground text-background border-foreground"
                : "bg-transparent text-muted-foreground border-border hover:border-foreground/40 hover:text-foreground"
            )}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Product Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-96 w-full rounded-2xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {filtered.map((product, i) => (
            <motion.div
              key={product._id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.07 }}
            >
              <ProductCard product={product} />
            </motion.div>
          ))}
        </div>
      )}

      {/* Footer note */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="flex items-center justify-center gap-2 text-xs text-muted-foreground pt-4"
      >
        <Lock className="w-3.5 h-3.5" />
        <span>Secure checkout powered by Stripe. All orders ship within 5–7 business days.</span>
      </motion.div>
    </div>
  );
}

// ─── Unauthenticated View ─────────────────────────────────────────────────────

function UnauthenticatedStore() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center gap-6">
      <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
        <Package className="w-8 h-8 text-muted-foreground" />
      </div>
      <div>
        <h2 className="text-2xl font-bold mb-2">Sign in to Shop</h2>
        <p className="text-muted-foreground text-sm max-w-xs">
          Create an account or sign in to browse and purchase GOAT WALK gear.
        </p>
      </div>
      <SignInButton />
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function StorePage() {
  return (
    <>
      <AuthLoading>
        <div className="px-4 pt-6 max-w-3xl mx-auto space-y-6">
          <Skeleton className="h-24 w-48" />
          <div className="flex gap-2">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-8 w-24 rounded-full" />)}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-96 w-full rounded-2xl" />)}
          </div>
        </div>
      </AuthLoading>
      <Unauthenticated>
        <UnauthenticatedStore />
      </Unauthenticated>
      <Authenticated>
        <StoreContent />
      </Authenticated>
    </>
  );
}
