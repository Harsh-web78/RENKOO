# Lifecycle rules — current Fix, dismissal, acknowledgement (backend truth)

These rules live in `RecommendationService.getRecommendation()` and the
Fix transition methods. The frontend never duplicates them; it renders
whatever the backend returns.

## Statuses

`available → reviewed → applied → (measured via outcome) → acknowledged`
plus `dismissed` as a terminal side-state. `acknowledged` is a persisted
`FixApplyStatus` enum value (schema `prisma/schema.prisma`).

## Rules

- **R1 — idempotent recommendation.** Repeated `GET .../recommendation`
  for the same snapshot reuses the same active Fix (same
  property + page + signal + snapshot period). No duplicate active fixes;
  proven by `recommendation.e2e.spec.ts` test 18.
- **R2 — dismissal ends the fix.** `dismissed` rows never become current
  again through any transition. The next `GET .../recommendation` for a
  persisting signal creates exactly one new active Fix (the dismissal
  applies to that fix incarnation, not to the underlying signal);
  proven by `acknowledge.e2e.spec.ts` "R2" (active count is exactly 1,
  old row stays `dismissed`, dismissed rows stay in history).
- **R3 — engine honesty.** The pure engine returns zero or one
  recommendation and honest empty states; covered by
  `recommendation.engine.spec.ts`.
- **R4 — fresh data may surface anew.** A new snapshot period with a
  persisting signal creates a new Fix (latest-wins for "current").
  Older active rows from superseded periods are left untouched and are
  inert: `GET .../fix` returns the latest only, and history lists only
  dismissed/measured/acknowledged rows. Proven by `acknowledge.e2e.spec.ts`
  "R4" (deterministic via directly-inserted newer snapshot).
- **R5 — acknowledged signals are suppressed.** After acknowledge, the
  same snapshot period + signal returns `no-signal` (nothing *new* worth
  doing) instead of recreating the identical fix. A different snapshot
  period lifts the suppression (R4). Proven by `acknowledge.e2e.spec.ts`
  tests 1–2.
- **Transitions are guarded.** `review` is idempotent; `apply` captures
  the baseline once and refuses `dismissed`/`acknowledged` fixes;
  `acknowledge` requires an existing outcome (otherwise a no-op success)
  and is idempotent; every transition re-checks workspace + property
  ownership (foreign ids → 404).

## History derivation (no separate table)

History = `dismissed` fixes + measured (`applied` with outcome) fixes +
`acknowledged` fixes, newest first (`createdAt desc, id desc`), via
`HistoryService` from the existing `Fix`/`Recommendation`/`FixOutcome`
rows. `available`/`reviewed`/`applied`-without-outcome rows are
"current", never history.
