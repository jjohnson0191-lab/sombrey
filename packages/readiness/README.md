# @sombrey/readiness

The domain boundary for Sombrey's readiness/recovery system.

## Phase 1 scope — types only

This package currently contains **foundational types only**:
`ReadinessInputs`, `ReadinessResult`, `ContributingFactor`,
`PersonalBaseline`, `AlgorithmVersion`.

**There is no scoring algorithm in this package.** No formula has been
invented, implemented, or approximated. `ReadinessResult.score` is
explicitly `number | null` so that "not enough data yet" or "this
algorithm version doesn't produce a score" are first-class, honest
states rather than a fabricated number.

## Planned future structure (not built yet)

```
wearable data
  -> normalization/   clean/flag raw samples, unit conversion
  -> baselines/         rolling personal baselines per metric
  -> derived/             trend/training-load/deviation metrics
  -> engine/                versioned scoring function
  -> versions/                registry of algorithm implementations
```

The engine is intended to run **server-side** (a Convex action/job),
not in the mobile app — so recalculation, auditing, and backtesting
against historical data are all possible without an app release. The
mobile app will only ever render a stored `ReadinessResult`, never
compute one locally.

## Product constraint this package exists to support

Until an algorithm version is actually validated: no medical claims, no
clinical-accuracy claims, no diagnosis, no implication that a score
predicts disease. This is enforced structurally by `score` being
nullable and `confidence` reflecting data sufficiency — not just by UI
copy discipline.
