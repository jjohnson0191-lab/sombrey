import type { CSSProperties, ReactNode } from "react";

/**
 * Studio Instrument environments — the approved design system's core
 * idea: one continuous tonal field (see index.css's env-0..env-5), and
 * every screen uses a different "crop" of it rather than its own
 * background color. Home gets the full dramatic sweep; task screens get
 * a narrower, calmer excerpt. Do not add a new ad-hoc gradient for a
 * screen that isn't listed here — extend this map instead, so the
 * environment stays one system.
 */
export type SceneName =
  | "home"
  | "trainOverview"
  | "trainActive"
  | "trainComplete"
  | "progress"
  | "aiCoach"
  | "settings";

const SCENES: Record<SceneName, string> = {
  home:
    "radial-gradient(ellipse 640px 520px at 30% 84%, var(--color-env-5) 0%, rgba(248,239,223,0) 62%), " +
    "linear-gradient(158deg, var(--color-env-0) 0%, var(--color-env-1) 28%, var(--color-env-2) 52%, var(--color-env-3) 74%, var(--color-env-4) 90%, var(--color-env-5) 100%)",
  trainOverview:
    "linear-gradient(158deg, var(--color-env-2) 0%, var(--color-env-3) 30%, var(--color-env-4) 65%, var(--color-env-5) 100%)",
  trainActive:
    "linear-gradient(158deg, var(--color-env-3) 0%, var(--color-env-4) 45%, var(--color-env-5) 100%)",
  trainComplete:
    "radial-gradient(ellipse 500px 380px at 75% 4%, rgba(255,255,255,0.3), transparent 58%), " +
    "linear-gradient(158deg, #4a5866 0%, #93a0a5 16%, #c7c2b4 36%, var(--color-env-4) 58%, var(--color-env-5) 100%)",
  progress:
    "linear-gradient(158deg, var(--color-env-1) 0%, var(--color-env-2) 35%, var(--color-env-3) 68%, #d6d0c1 100%)",
  aiCoach:
    "radial-gradient(ellipse 420px 320px at 50% 42%, var(--color-env-5) 0%, rgba(248,239,223,0) 68%), " +
    "linear-gradient(158deg, #5c6975 0%, #9fa79e 35%, #e3dece 70%, #f6eede 100%)",
  settings: "linear-gradient(160deg, #b7bbb2 0%, #d8d2c4 60%, var(--color-env-4) 100%)",
};

/** Full-bleed Studio Instrument backdrop for one screen. */
export function Environment({
  scene,
  className,
  style,
  children,
}: {
  scene: SceneName;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div
      className={className}
      style={{ background: SCENES[scene], ...style }}
    >
      {children}
    </div>
  );
}
