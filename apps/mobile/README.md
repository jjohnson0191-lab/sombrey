# Sombrey Mobile

The new, customer-facing Sombrey iOS application. React + TypeScript +
Capacitor. **Not** the legacy `src/` SPA wrapped for mobile — a
purpose-built app that imports selected reusable packages
(`@sombrey/shared`, `@sombrey/wearable`, `@sombrey/readiness`) and calls
the shared Convex backend directly.

## Phase 3 status: foundation

What exists: the app shell, five-tab navigation, Clerk + Convex auth
wiring, a small design-system (`src/ui/`), the wearable/AI/readiness/
subscription/notifications/account-deletion service boundaries, and
Capacitor + an iOS project (see the Phase 3 report for exact iOS-tooling
outcomes in this environment).

What does NOT exist yet (later, controlled phases): the full workout/
nutrition/AI-chat/wearable-BLE/readiness-algorithm systems, StoreKit,
APNs, complete onboarding, a production-polished account-deletion UI.
Screens for those areas are intentionally minimal placeholders proving
the architecture, not the real feature.

## Running it

```
pnpm --filter @sombrey/mobile dev
```

Requires `apps/mobile/.env.local` — `VITE_CONVEX_URL` is pre-filled
(the Sombrey dev deployment); `VITE_CLERK_PUBLISHABLE_KEY` must be
filled in from the Clerk dashboard (not committed, not invented here).

## Directory shape

```
src/
  ui/              design-system primitives
  navigation/      TabBar, AppShell (the 5-tab shell)
  screens/         one file per screen, thin — logic lives in features/
  features/
    auth/          Clerk boundary (useSombreyAuth, AppProviders)
    convex/        the one ConvexReactClient instance
    wearable/      SombreyWearableService + Capacitor plugin contract
    ai/            AI Coach boundary (Convex actions only, no OpenAI)
    readiness/     typed foundation, no backend yet
    subscription/  entitlement boundary, no StoreKit yet
    notifications/ category boundary, no APNs yet
    account/       account-deletion boundary (real Convex mutation)
native/ios/        Swift plugin skeleton (see native/ios/README.md —
                    not yet wired into an Xcode target)
```

## What isn't reused from `src/`

No page, route, layout, or provider is imported from the legacy SPA.
Pure business logic already extracted in Phase 1
(`packages/shared/src/{progression,workout-duration,cn}.ts`) is reused;
everything else in `src/` is reference material only.
