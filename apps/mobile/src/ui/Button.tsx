import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@sombrey/shared";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "bg-accent text-background hover:bg-accent-strong",
  secondary: "bg-surface-elevated text-foreground border border-border",
  ghost: "bg-transparent text-foreground-muted hover:text-foreground",
  danger: "bg-transparent text-danger border border-danger/40",
};

export function Button({
  children,
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode; variant?: Variant }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3",
        "text-sm font-semibold transition-colors active:scale-[0.98]",
        "disabled:opacity-40 disabled:pointer-events-none",
        VARIANT_CLASSES[variant],
        className,
      )}
      {...props}
    >
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
        "inline-flex h-10 w-10 items-center justify-center rounded-full",
        "bg-surface-elevated text-foreground-muted hover:text-foreground",
        "active:scale-95 transition-colors",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
