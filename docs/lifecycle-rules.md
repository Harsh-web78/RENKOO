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
  for the same evidence reuses the same active Fix (same
  property + page + signal + fingerprint; legacy same-period match kept as
  fallback). No duplicate active fixes; proven by
  `recommendation.e2e.spec.ts` test 18 and `remember.e2e.spec.ts` 3+4.
- **R2 — dismissal ends the fix AND is remembered.** `dismissed` rows never
  become current again through any transition. A later
  `GET .../recommendation` with the SAME evidence fingerprint returns
  honest `no-signal` (remembered) instead of creating a new Fix — the
  dismissal applies to the evidence, not just the incarnation. Only
  genuinely new evidence (different fingerprint) creates a new active Fix;
  proven by `remember.e2e.spec.ts` 1–4 and `acknowledge.e2e.spec.ts` "R2".
- **R3 — engine honesty.** The pure engine returns zero or one
  recommendation and honest empty states; covered by
  `recommendation.engine.spec.ts`.
- **R4 — fresh evidence may surface anew.** A snapshot with a materially
  different evidence fingerprint creates a new Fix (latest-wins for
  "current"). Previous `available`/`reviewed` incarnations of the same
  lineage are marked `superseded` (terminal, system-written — never a
  dismissal, never an apply) so they cannot resurface or linger as
  invisible active orphans. `applied` (measured or pending) rows are never
  rewritten. Proven by `remember.e2e.spec.ts` 11 and
  `acknowledge.e2e.spec.ts` "R4" (deterministic via directly-inserted
  newer snapshot).
- **R5 — acknowledged signals are suppressed.** After acknowledge, the
  same snapshot period + signal returns `no-signal` (nothing *new* worth
  doing) instead of recreating the identical fix. A different snapshot
  period lifts the suppression (R4). Proven by `acknowledge.e2e.spec.ts`
  tests 1–2.
- **R6 — signal fingerprint (Remember).** Every created Fix stores a
  deterministic SHA-256 `signalFingerprint` over its material evidence
  (workspace/property/page/signal scope + current/prior page metrics +
  evidence query rows; see `signal-fingerprint.ts`). Excluded: timestamps,
  snapshot periods, row ids, generated prose. Engine thresholds/signals/
  wording are untouched — the fingerprint lives in the persistence layer.
  Legacy `NULL` rows are backfilled on first read from their persisted
  Recommendation; unresolvable rows fail open (never suppress on unknown).
  Memory is strictly per (workspace, property, page, signal): different
  page/signal/property/workspace never suppress. Proven by
  `remember.e2e.spec.ts` 1–12 and `signal-fingerprint.spec.ts`.
- **R7 — post-window measurement (Measure).** `applyFix` pins the exact
  baseline snapshot (`Fix.baselineSnapshotId`) once, idempotently; the
  baseline is never rewritten by GET/ingest/check. `checkFix` after the
  14-day window selects the earliest snapshot with `retrievedAt >=
  expectedMeasurementDate` that arrived after the baseline capture and is
  not the baseline row itself (never "latest", never self-compare), scoped
  to workspace + property. No qualifier → transient `data_delayed` (nothing
  persisted, later data can still be measured); existing outcomes are
  replayed, never recalculated. Classifier thresholds and non-causal
  language ("does not establish causation") are unchanged. Proven by
  `measurement-selection.e2e.spec.ts` 1–8, 10 and `measurement.spec.ts`.
- **R8 — automatic measurement (worker).** Applying a Fix schedules ONE
  delayed BullMQ `measurement` job (`{ fixId }` payload only) for the
  stored window end; a Worker runs the shared `measureById` core — the same
  Prompt 3 selection/classifier/outcome rules as manual `checkFix`, never a
  duplicate implementation. Pre-window fire → re-enqueue for the window end;
  elapsed-but-no-data → bounded retries (6 attempts, exponential from 1h),
  never a fake outcome; missing/ineligible rows → permanent skip, never
  retried. `FixOutcome.fixId` uniqueness (+ the existing P2002 replay) is
  the final single-outcome guard. `sweepEligible()` reconciles pre-Prompt-4
  / lost / failed jobs in bounded batches at bootstrap (no production cron
  invented). The worker never creates recommendations/fixes, never touches
  fingerprints or memory, and needs no ingestion changes. Proven by
  `measurement-worker.e2e.spec.ts` and `measurement-reliability.e2e.spec.ts`.
- **R9 — hourly recovery sweep (scheduler).** `@nestjs/schedule`
  (`ScheduleModule`, hourly `0 * * * *`) invokes the existing
  `sweepEligible()` via `runMeasurementRecoverySweep()` — the trigger calls
  nothing else, so eligibility/dedupe/retry/selection semantics are
  unchanged. Overlap within one process is skipped (guard); across processes
  Prompt 5 idempotency (deterministic ids, live-scan dedupe, outcome
  uniqueness) converges to one job and one outcome. Sweep failures are
  logged and retried next hour without touching measurement state; the
  trigger is absent in test env (no hourly timer in jest) and stops cleanly
  on shutdown. Proven by `measurement-scheduler.e2e.spec.ts`.
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
