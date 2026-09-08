import { useQuery, useMutation } from "convex/react";
import { Authenticated, Unauthenticated, AuthLoading } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { SignInButton } from "@/components/ui/signin.tsx";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty.tsx";
import { ShoppingCart, Trash2, Plus, Minus, ShoppingBag, ArrowLeft, AlertTriangle } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { cn } from "@/lib/utils.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatPrice(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function getStockForVariant(product: { stockQuantity?: number | null }): number | null {
  if (product.stockQuantity === undefined || product.stockQuantity === null) return null;
  return product.stockQuantity;
}

// ─── Cart Item Row ─────────────────────────────────────────────────────────────

type CartItemWithProduct = {
  _id: Id<"cartItems">;
  productId: Id<"storeProducts">;
  variantId: string;
  variantName: string;
  quantity: number;
  priceAtAdd: number;
  product: {
    _id: Id<"storeProducts">;
    name: string;
    imageUrl: string;
    category: string;
    active: boolean;
    stockQuantity?: number | null;
    variants: Array<{ id: string; name: string; price: number }>;
  } | null;
};

function CartItemRow({ item }: { item: CartItemWithProduct }) {
  const updateQty = useMutation(api.cart.updateCartQuantity);
  const remove = useMutation(api.cart.removeFromCart);

  const product = item.product;
  // Use live price from variant if available, fall back to snapshot
  const liveVariant = product?.variants.find((v) => v.id === item.variantId);
  const currentPrice = liveVariant?.price ?? item.priceAtAdd;
  const priceChanged = liveVariant && liveVariant.price !== item.priceAtAdd;

  const stock = product ? getStockForVariant(product) : null;
  const isOutOfStock = product && !product.active || (stock !== null && (stock ?? 0) <= 0);
  const atStockLimit = stock !== null && item.quantity >= (stock ?? 0);

  const handleQty = async (delta: number) => {
    try {
      await updateQty({ cartItemId: item._id, quantity: item.quantity + delta });
    } catch (err) {
      if (err instanceof Error) toast.error(err.message);
      else toast.error("Could not update quantity.");
    }
  };

  const handleRemove = async () => {
    try {
      await remove({ cartItemId: item._id });
      toast.success("Item removed.");
    } catch {
      toast.error("Could not remove item.");
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 10 }}
      className={cn(
        "flex gap-4 p-4 rounded-2xl border bg-card",
        isOutOfStock ? "opacity-60 border-destructive/30" : "border-border"
      )}
    >
      {/* Image */}
      <div className="w-20 h-20 rounded-xl overflow-hidden bg-muted shrink-0 relative">
        {product ? (
          <img src={product.imageUrl} alt={product.name} className={cn("w-full h-full object-cover", isOutOfStock && "grayscale")} />
        ) : (
          <div className="w-full h-full bg-muted" />
        )}
        {isOutOfStock && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
            <span className="text-[8px] font-bold text-white text-center leading-tight">OUT OF STOCK</span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-sm truncate">{product?.name ?? "Unknown Product"}</p>
            <p className="text-xs text-muted-foreground">{item.variantName}</p>
          </div>
          <button onClick={handleRemove} className="cursor-pointer text-muted-foreground hover:text-destructive transition-colors shrink-0 mt-0.5">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        {priceChanged && (
          <div className="flex items-center gap-1 text-[10px] text-yellow-600 dark:text-yellow-400">
            <AlertTriangle className="w-3 h-3" />
            Price updated to {formatPrice(currentPrice)}
          </div>
        )}
        {isOutOfStock && (
          <p className="text-[10px] text-destructive font-medium">This item is no longer available</p>
        )}
        {!isOutOfStock && stock !== null && stock <= 5 && (
          <p className="text-[10px] text-yellow-600 dark:text-yellow-400">Only {stock} left in stock</p>
        )}

        {/* Quantity + line total */}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleQty(-1)}
              disabled={item.quantity <= 1}
              className={cn("w-7 h-7 rounded-lg border flex items-center justify-center cursor-pointer transition-colors",
                item.quantity <= 1 ? "opacity-40 cursor-not-allowed" : "hover:bg-muted"
              )}
            >
              <Minus className="w-3 h-3" />
            </button>
            <span className="text-sm font-bold w-6 text-center">{item.quantity}</span>
            <button
              onClick={() => handleQty(1)}
              disabled={!!isOutOfStock || atStockLimit}
              className={cn("w-7 h-7 rounded-lg border flex items-center justify-center cursor-pointer transition-colors",
                (isOutOfStock || atStockLimit) ? "opacity-40 cursor-not-allowed" : "hover:bg-muted"
              )}
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>
          <span className="font-bold text-sm">{formatPrice(currentPrice * item.quantity)}</span>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Cart Content ─────────────────────────────────────────────────────────────

function CartContent() {
  const navigate = useNavigate();
  const rawItems = useQuery(api.cart.getCart, {});
  const clearCart = useMutation(api.cart.clearCart);

  if (rawItems === undefined) {
    return (
      <div className="space-y-4 px-4 pt-6 max-w-lg mx-auto">
        <Skeleton className="h-8 w-40" />
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-28 w-full rounded-2xl" />)}
      </div>
    );
  }

  // Cast to typed items
  const items = rawItems as CartItemWithProduct[];

  if (items.length === 0) {
    return (
      <div className="px-4 pt-6 pb-8 max-w-lg mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => navigate(-1)} className="cursor-pointer text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-2xl font-black tracking-tight">Your Cart</h1>
        </div>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><ShoppingCart /></EmptyMedia>
            <EmptyTitle>Your cart is empty</EmptyTitle>
            <EmptyDescription>Browse the store and add some items to get started.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Link to="/store">
              <Button size="sm" className="cursor-pointer gap-2">
                <ShoppingBag className="w-4 h-4" />
                Shop Now
              </Button>
            </Link>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  // Compute totals using live prices
  const subtotal = items.reduce((sum, item) => {
    const liveVariant = item.product?.variants.find((v) => v.id === item.variantId);
    const price = liveVariant?.price ?? item.priceAtAdd;
    return sum + price * item.quantity;
  }, 0);

  const unavailableCount = items.filter((item) => {
    const stock = item.product ? getStockForVariant(item.product) : null;
    return !item.product?.active || (stock !== null && (stock ?? 0) <= 0);
  }).length;

  const handleClear = async () => {
    try {
      await clearCart({});
      toast.success("Cart cleared.");
    } catch {
      toast.error("Could not clear cart.");
    }
  };

  return (
    <div className="px-4 pt-6 pb-32 max-w-lg mx-auto space-y-6">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="cursor-pointer text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-2xl font-black tracking-tight">Your Cart</h1>
          <span className="text-sm text-muted-foreground">({items.length} item{items.length !== 1 ? "s" : ""})</span>
        </div>
        <button onClick={handleClear} className="cursor-pointer text-xs text-muted-foreground hover:text-destructive transition-colors">
          Clear all
        </button>
      </motion.div>

      {/* Unavailable alert */}
      {unavailableCount > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2 p-3 rounded-xl border border-destructive/30 bg-destructive/10 text-sm text-destructive">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {unavailableCount} item{unavailableCount > 1 ? "s are" : " is"} out of stock and can't be checked out.
        </motion.div>
      )}

      {/* Items */}
      <div className="space-y-3">
        <AnimatePresence>
          {items.map((item) => (
            <CartItemRow key={item._id} item={item} />
          ))}
        </AnimatePresence>
      </div>

      {/* Order summary */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-border bg-card p-5 space-y-3"
      >
        <h2 className="font-bold text-base">Order Summary</h2>
        <div className="space-y-2 text-sm">
          {items.map((item) => {
            const liveVariant = item.product?.variants.find((v) => v.id === item.variantId);
            const price = liveVariant?.price ?? item.priceAtAdd;
            return (
              <div key={item._id} className="flex justify-between text-muted-foreground">
                <span className="truncate max-w-[60%]">{item.product?.name ?? "Item"} × {item.quantity}</span>
                <span>{formatPrice(price * item.quantity)}</span>
              </div>
            );
          })}
        </div>
        <div className="border-t pt-3 flex justify-between font-bold text-lg">
          <span>Total</span>
          <span>{formatPrice(subtotal)}</span>
        </div>
      </motion.div>

      {/* Checkout note */}
      <p className="text-xs text-muted-foreground text-center">
        Checkout via bank transfer or card payment — contact your coach to complete your order.
      </p>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CartPage() {
  return (
    <>
      <AuthLoading>
        <div className="px-4 pt-6 max-w-lg mx-auto space-y-4">
          <Skeleton className="h-8 w-40" />
          {[1, 2].map((i) => <Skeleton key={i} className="h-28 w-full rounded-2xl" />)}
        </div>
      </AuthLoading>
      <Unauthenticated>
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 px-4 text-center">
          <ShoppingCart className="w-12 h-12 text-muted-foreground" />
          <div>
            <h2 className="text-xl font-bold mb-2">Sign in to view your cart</h2>
            <p className="text-muted-foreground text-sm">Your cart is saved to your account.</p>
          </div>
          <SignInButton />
        </div>
      </Unauthenticated>
      <Authenticated>
        <CartContent />
      </Authenticated>
    </>
  );
}
