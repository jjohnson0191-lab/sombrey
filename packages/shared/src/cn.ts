/**
 * Tailwind class-merging helper, ported from the legacy app's
 * src/lib/utils.ts. Portable — clsx/tailwind-merge have no DOM
 * dependency — and relevant to apps/mobile since Capacitor still
 * renders a Tailwind-styled WebView.
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
