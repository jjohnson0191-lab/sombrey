# AI feature boundary

`useAiCoach.ts` demonstrates the pattern: a thin hook wrapping a Convex
`useAction` call, exposed to screens as plain async functions. The
backend action (`convex/ai/coach.ts`) is what talks to the AI Coach
provider abstraction (`convex/aiCoach/providers`) — this hook, and every
screen that uses it, never sees a provider name or API key.

Not built in Phase 3 (foundation only — see the phase report): chat
history persistence UI, plan-generation trigger UI, meal-suggestion UI,
camera-analysis capture UI, check-in flow UI. Each follows the same
`useAction`-wrapped-in-a-hook pattern once built.

Every AI-generated surface in the app should render an
`AiDisclosureBadge` (`src/ui/AiDisclosureBadge.tsx`) near the content —
see that component's header comment for the disclosure requirement it
exists to satisfy.
