# @sombrey/shared

Framework-agnostic pure TypeScript, shared between Sombrey's apps (`apps/mobile`,
`apps/website`, `apps/owner`) and the Convex backend.

## Constraints

This package must never depend on:

- React
- the Convex client
- Capacitor
- native iOS/Swift
- browser-only APIs (`window`, `document`, DOM types)
- Hercules

`tsconfig.json` enforces the browser-API constraint at the type level —
`lib` is `["ES2022"]` only, with no `"DOM"`, so any accidental use of a
browser global fails to typecheck.

## Contents (Phase 1)

- `progression.ts` — progressive-overload rep/weight-cycle math, copied
  from the legacy app's `src/lib/progression.ts`.
- `workout-duration.ts` — workout duration estimator, copied from the
  legacy app's `src/lib/workout-duration.ts`.
- `cn.ts` — Tailwind class-merge helper, copied from the legacy app's
  `src/lib/utils.ts`.

These are copies, not moves — the legacy `src/lib/*` files are untouched
and the existing SPA keeps working unmodified. Once `apps/mobile` exists
and consumes `@sombrey/shared` directly, the legacy copies can be
retired in a later, explicit phase.

## Not yet in this package

Anything not already proven platform-independent — e.g. the readiness
algorithm (`@sombrey/readiness`) and wearable domain types
(`@sombrey/wearable`) live in their own packages, not here.
