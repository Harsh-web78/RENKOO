# History + acknowledge integration notes (Prompt 13 → current)

## Backend history (implemented)

- `GET /api/v1/workspaces/:workspaceId/history` — workspace-scoped,
  `SessionAuthGuard` + `WorkspaceAuthGuard`, newest first
  (`createdAt desc, id desc`), `?limit` (default 25, max 100) + `?offset`,
  `{items, total, limit, offset}`.
- `GET /api/v1/workspaces/:workspaceId/history/:fixId` — workspace-scoped
  lookup; unknown ids, other workspaces' fixes, and non-history (current)
  fixes all return 404 without leaking existence.
- History = `dismissed` fixes + measured (`applied` with outcome) fixes,
  derived from the existing `Fix`/`Recommendation`/`FixOutcome` models —
  no separate History table.
- Responses contain no tokens, no `passwordHash`, no `siteUrl`
  (stripped from snapshot provenance at the mapping boundary).

## Frontend real mode (`NEXT_PUBLIC_USE_REAL_PROVIDER=true`)

- History list/detail come from the backend; per-property screens filter
  the workspace history by the fix's authoritative
  `dataMeta.property.id`. Detail always re-fetches (never stale local).
- Mock history behavior is unchanged when the flag is false.

## Remaining known gap: acknowledge resurrection — RESOLVED (Prompt 14)

`FixApplyStatus` gained a persisted `acknowledged` value. `POST
.../fix/:fixId/acknowledge` transitions measured fixes server-side,
`GET .../fix` excludes acknowledged rows, and `GET .../recommendation`
suppresses the actioned signal for the same snapshot (rule R5, see
`docs/lifecycle-rules.md`). Hard reload no longer resurfaces acknowledged
fixes; they remain visible in history as measured entries.

Deploy note: the new enum value requires a Prisma migration on existing
databases (`ALTER TYPE "FixApplyStatus" ADD VALUE 'acknowledged'` via
`prisma migrate deploy`); see `docs/production-checklist.md`.
