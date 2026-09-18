import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@sombrey/shared";

type Variant = "primary" | "secondary" | "ghost" | "danger";

/**
 * Sombrey's button system — approved V1:
 *  - primary: the illuminated translucent glass pill (si-pill-primary,
 *    index.css). Real physical response comes from CSS :active, not JS
 *    state, so it's genuinely tactile on a real device.
 *  - secondary: outline-only pill, no glass — hierarchy comes from
 *    material, not just size/color.
 *  - ghost: plain text action (Close, Skip rest, Sign out).
 *  - danger: plain text action in the muted warm-red danger token
 *    (Delete account) — never a filled button, so it can't be mistaken
 *    for a primary action.
 */
const VARIANT_CLASSES: Record<Variant, string> = {
  // primary/secondary have their own bespoke :disabled treatment in
  // index.css (the glass loses its illumination) — no generic opacity
  // fade layered on top of that.
  primary: "si-pill-primary inline-flex items-center justify-center disabled:pointer-events-none",
  secondary: "si-pill-secondary inline-flex items-center justify-center disabled:pointer-events-none",
  ghost: "text-sm font-medium text-ink-soft disabled:pointer-events-none disabled:opacity-40",
  danger: "text-sm font-medium text-danger disabled:pointer-events-none disabled:opacity-40",
};

export function Button({
  children,
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode; variant?: Variant }) {
  return (
    <button className={cn(VARIANT_CLASSES[variant], className)} {...props}>
      {children}
    </button>
  );
}

export function IconButton({
  children,
  label,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode; label: string }) {
  return (
    <button
      aria-label={label}
      className={cn(
        "inline-flex h-11 w-11 items-center justify-center rounded-full",
        "text-ink-soft transition-transform active:scale-95",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
