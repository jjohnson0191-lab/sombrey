# Sombrey AI Coach

The Sombrey product intelligence layer. Orchestrates every AI capability
the app uses — workout generation, plan modification, meal suggestions,
check-in assessment, progress insights, and the coach chat itself.

```
Sombrey App
  -> AI capability (convex/AI/*.ts — coach.ts, planGenerator.ts, ...)
  -> AI Provider Interface (convex/aiCoach/providers/types.ts)
  -> Current provider adapter (convex/aiCoach/providers/openai.ts)
  -> Provider API (OpenAI, directly — no Hercules AI Gateway)
```

## Why the capability files still live under `convex/AI/`

The existing `convex/AI/*.ts` files already organize the product's AI
business logic by capability (one file per job: coach chat, plan
generation, plan modification, meal suggestions, check-in assessment,
progress insights, camera analysis). That organization is sound and
Hercules-independent in itself — only the *transport* each file used
(a direct `new OpenAI({ baseURL: "https://ai-gateway.hercules.app/v1",
apiKey: HERCULES_API_KEY })` call) was Hercules-coupled. So "the AI
Coach" in this codebase is `convex/AI/*.ts` (the capabilities) plus
`convex/aiCoach/providers/*` (the abstraction they all route through) —
not a separate reimplementation of logic that already existed.

`convex/AI/cameraAnalysis.ts` is the one exception: it already calls
Gemini + Edamam directly and was never Hercules-coupled, so it isn't
routed through this abstraction — it has its own, already-independent,
single-purpose vision pipeline.

## Provider-agnosticism

Sombrey is not architected around OpenAI. `convex/aiCoach/providers/`
defines a `TextCompletionProvider` interface; every capability file
depends only on that interface via `getTextProvider()`. OpenAI is the
V1 adapter — replacing it later means adding a new adapter file and
changing one line in `providers/index.ts`, not touching any capability
file, the iOS app, or the Convex data model.

## Secrets

Provider API keys (`OPENAI_API_KEY`) live only in Convex environment
variables, read server-side inside the adapter. Never in client code,
never in the mobile app, never committed to the repo.

## Current model — temporary, not a final decision

The adapter defaults to `gpt-4o-mini` (overridable via the
`SOMBREY_AI_MODEL` Convex environment variable, or per-call via
`options.model`). This is V1 development configuration only. The
original Hercules-gateway code used a model string
(`"openai/gpt-5-mini"`) that only makes sense inside a multi-provider
gateway's own namespacing — it isn't a real OpenAI API model id, so it
wasn't carried forward. Final provider and model selection is a
separate, pending decision (AI quality evaluation), not made by this
default. Nothing about the interface, the iOS app, or the Convex data
model depends on which model or vendor is actually behind
`getTextProvider()`.

## AI disclosure — a Phase 3/mobile UX requirement, not addressed by this backend

Sombrey's core product surface is AI-generated: the AI Coach chat, the
AI-generated workout plan and its AI-driven modifications, AI meal
suggestions, AI meal-photo macro analysis, AI-assessed check-ins, and
AI progress/recovery interpretation. The customer-facing app must
disclose to users, in the UI, that this content is AI-generated rather
than presenting it as if it came from a human coach or a verified
medical/clinical source — particularly for anything touching body
composition estimates, recovery/readiness guidance, or health-adjacent
interpretation, where overstating certainty would be actively
misleading. This is a product/legal requirement to design real
disclosure copy for during mobile UX work, not something this backend
pass invents wording for or enforces — no specific disclosure text is
proposed here, and no legal claim about compliance is made. Flagged so
it isn't lost by the time Phase 3 starts.
