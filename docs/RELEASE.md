# Release notes

What's been deployed to production, when, and what's pending.

> Last updated: 2026-05-15 (LiveJob materialized view — pending deploy)

---

## Currently in production

- **URL:** <https://vera-mvp.vercel.app>
- **Database:** GCP Cloud SQL `vera_prod` at `34.56.121.151:5432`
- **Read path:** DB (`USE_DB_DATA_SOURCE=1`)
- **Branch deployed:** `main`
- **Latest deployment hash:** check `vercel ls --prod | head -2`

---

## Deploy cadence

No formal release cycle. We deploy on demand from the canonical repo:

```bash
cd /Users/aditya-levich/Build/israil_mvp
vercel --prod --yes
```

Auto-deploy is broken until the `hexabytecode` ↔ `adityauphade-mac`
identity mismatch on Vercel is fixed (see entry #1 in
[`TROUBLESHOOTING_HISTORY.md`](TROUBLESHOOTING_HISTORY.md)). Until then,
manual deploy after every merge to `main`.

---

## Release log

Reverse-chronological. Each entry describes the user-visible behavior change.

### 2026-05-15 — `LiveJob` materialized view (pending deploy)

**Branch `claude/gracious-hawking-3a821c` — not yet on `main`, not yet on production.**

Dashboard read path moved from `SELECT DISTINCT ON ... FROM RawRooflinkJob` (parsing JSONB on every request) to a Postgres materialized view (`LiveJob`) with the AR/write-offs filter fields and the duplicate-address count extracted as proper indexed columns. The user-visible effect is **faster pages**, especially right after a backfill sync:

- AR endpoints (`/api/jobs/aging` and four siblings): post-promote cache miss dropped from ~900 ms to ~30 ms (~30× faster).
- Write-offs (`/dashboard/write-offs`): post-promote cache miss dropped from ~1100 ms to ~340 ms (~3× faster).
- Raw query time fell from ~1200 ms to ~1 ms (measured with EXPLAIN ANALYZE on `vera_dev`).

Cost moved (not added): `REFRESH MATERIALIZED VIEW CONCURRENTLY "LiveJob"` runs inside `tick-worker.promote()` after each non-empty `rooflink_jobs` promote. Takes ~3 s on 100 k rows but runs on the backfill worker, off the user-facing request path. CONCURRENTLY keeps the view readable during the refresh.

**Also in this change:** the empty-incremental short-circuit (Fix 4). An incremental sync that finds zero new rows now completes without promoting — no refresh, no cache bust, no notification email. Existing `vera_prod` data may have a backlog of empty promoted runs; demote them with the one-shot SQL below.

**Files:**
- `apps/web/prisma/migrations/20260515000000_add_livejob_materialized_view/migration.sql` — view + indexes
- `apps/web/lib/backfill/merge-view.ts` — read helpers rewritten to read from `LiveJob`
- `apps/web/lib/backfill/tick-worker.ts` — REFRESH call + empty-incremental short-circuit
- `DASHBOARD_DATA_FETCH_REVIEW.md`, `MULTI_RECIPIENT_CODE_REVIEW.md` — review writeups (not deployed, kept in repo for context)

**Verification done in dev:**
- OLD vs NEW row-by-row diff: zero discrepancies across `dedup`, `data_version`, `ar_membership`, `addressDupCount`, and `writeoffs` checks. Script at `/tmp/verify-livejob.sql` (also reproducible against prod by adapting the connection).
- `/api/jobs/aging` returns 127 jobs / $1,236,826.70 / 26 duplicate-address anomalies — identical to the old code path.
- Typecheck (`tsc --noEmit`) clean.
- All `/dashboard/*` pages return 200.
- **End-to-end backfill flow tested.** Simulated a complete backfill cycle: created a new `BackfillRun`, wrote a modified `RawRooflinkJob` row for an existing AR job (bumped balance from $52,155.79 → $99,999.99), marked the run `promoted=true`, ran `REFRESH MATERIALIZED VIEW CONCURRENTLY "LiveJob"`, and hit `/api/jobs/aging`. Result: `totalBalance` reflected the new value (delta exactly $47,844.20), job 296667 in the response carried the new balance, totalCount remained 127. New data flows end-to-end exactly as expected. Cleanup verified: after deleting the synthetic row and run + refresh, baseline restored to 127 jobs / $1,236,826.70.
- Bug found and fixed during verification: `excludeFromQb` was defined as `(payload->>'exclude_from_qb') = 'true'`, which returns NULL for missing fields. The defensive old logic treated missing-field rows as "not excluded" (include in AR). Fixed to `COALESCE(... = 'true', false)` so missing fields → false → row included. Without this, prod rows with missing `exclude_from_qb` would have been silently dropped from the dashboard.

**Production deploy checklist** (do not deploy until these are checked off):

1. Verify the migration applies cleanly against a vera_prod **snapshot** (not vera_prod itself first). `CREATE MATERIALIZED VIEW` on 121 k rows took ~3 s in dev — production may be slower.
2. Time the first `REFRESH MATERIALIZED VIEW CONCURRENTLY` in the snapshot. Confirm it completes within the backfill worker's tick budget.
3. After deploy, run the verification script against prod to confirm `LiveJob` matches the old `DISTINCT ON` logic on production data.
4. Run the one-shot cleanup SQL to demote existing empty-incremental promoted runs:
   ```sql
   UPDATE "BackfillRun" SET promoted = false
   WHERE mode = 'incremental' AND "itemsProcessed" = 0 AND promoted = true;
   ```
   Idempotent. Confirms zero unnecessary REFRESHes at next tick.
5. Watch the audit log and backfill worker logs for the first 24 h. If `[backfill] LiveJob refresh failed` ever appears, the cache will be stale until the next successful refresh — investigate immediately.

**Rollback path:** the change is self-contained. To revert:
1. Revert the merge-view.ts read helpers (single commit).
2. Revert the tick-worker promote() change (same commit).
3. `DROP MATERIALIZED VIEW "LiveJob";` — `RawRooflinkJob` is untouched and remains the source of truth.

No data loss in either direction.

---

### 2026-05-14 — Multi-recipient notifications + audited follow-up send

**`0cdedd0` — Two related features shipped together.**

*Multi-recipient notifications.* Every notification surface in the
scheduler — daily AR brief, weekly summary, monthly close, and both
data-sync sources (`rooflink_jobs`, `rooflink_lineitems`) — now accepts
up to six recipient emails instead of one. A new `EmailChipInput`
primitive in `@vera/ui` drives the UX (paste-splits on commas, Backspace
removes the last chip, invalid emails caught inline). Sync emails read
from `BackfillSchedule.recipients` rather than fanning out to every user
on the tenant, so the operator now controls who hears about a sync run.
Run-now is gated on a non-empty recipients list to prevent silent
no-email syncs; when the list is empty, `tick-worker` writes
`backfill.notification_skipped_no_recipients` to the audit log.

*Audited follow-up email send.* The "Draft email" button on
`/dashboard/follow-ups` now opens a compose modal with TO + CC chip
inputs, sends through Resend via a new audited route
`/api/follow-ups/send`, and writes a row to `AuditLog` per send. The old
`mailto:` fallback is retired.

**Schema migrations applied to prod:**

- `20260514120527_schedule_recipients_array` — `Schedule.recipient` →
  `Schedule.recipients TEXT[]`; `BackfillSchedule` gains
  `recipients TEXT[]`. Non-destructive: existing recipient values were
  preserved as single-element arrays.
- `20260514120845_sendlog_toemails_array` — `SendLog.toEmail` →
  `SendLog.toEmails TEXT[]`. Same non-destructive pattern.

Both Schedule and BackfillSchedule were empty in prod at deploy time, so
no rows needed backfilling. SendLog was also empty.

**Rollback:** `vercel rollback` to the prior production deployment
(`dpl_HJ1XhgoNZRUr2Gv6L7YvFBPFUQpg`), then reverse the schema by hand
against `vera_prod` (ADD old column → backfill from `recipients[1]` →
DROP new column). Inverse SQL kept in the commit message of the next
revert if needed.

### 2026-05-14 — Documentation revamp (no runtime change)

**`5bc354a` + `f499a83` — Docs-only.** Full revamp of the project's
documentation post-DB-cutover. 29 markdown files → 17 active + 10
historical. Every active doc reflects the current production topology
(GCP Cloud SQL, DB read path, PDF emails, Playwright safety guard).

New docs: `docs/SYNC_EMAIL.md`, `docs/GCP_DB_ADMIN.md`, `docs/BACKLOG.md`
(consolidated from three earlier backlogs). Historical plans moved to
`docs/_history/`. New `CLAUDE.md` rule #14: every prod deploy gets a
release-log entry — this commit is the first one to follow it.

No runtime behavior change. The deploy refreshes the Vercel build
artifact and propagates the docs to the canonical Git remote. Production
APIs / dashboards continue to behave exactly as before.

**Rollback:** `vercel rollback` to the prior production deployment if
something unexpected breaks; the prior deployment is functionally
identical anyway.

### 2026-05-14 — Database cutover day

A long day. Multiple shipments and one rolled-back attempt.

**`1995d41` — Post-sync PDF email on backfill completion.** The backfill
sync-complete email now carries a one-page PDF listing the touched
records, so operators see *which* records flowed through, not just the
count. The render is done in-process with `@react-pdf/renderer`; the PDF
is attached via Resend. Capped at 200 records per run; if a run touched
more, the PDF lists the top 200 by balance (jobs) or work-RCV (line
items). Full pipeline doc in [`SYNC_EMAIL.md`](SYNC_EMAIL.md).

**`083f6a8` — Push DB read path filtering into Postgres.** The earlier
DB cutover attempt failed because each cold dashboard request pulled the
full 120,300-row JSONB population (~200 MB) into Node before filtering
to the ~130 AR-eligible jobs. Across the public internet to Vercel, that
times out. The fix uses two SQL helpers — `getLiveARJobsWithContext` and
`getLiveJobsForWriteOffs` — that push the working-set filter and the
duplicate-address aggregation into Postgres via CTEs. Per-cold-request
transfer dropped to ~650 KB, a 320× reduction. Cold-start time dropped
from "function timed out" to ~1.5 s server + sub-second wire. Domain
transforms (heat score, anomalies, reconciliation) stay in TypeScript —
no SQL duplication. Full design rationale in [`DATA_MODEL.md`](DATA_MODEL.md).

**`083f6a8` (continued) — Playwright safety guard.** Tests' global-setup
file wipes 8 data tables before every run. Today that nuked ~120k
Rooflink job payloads in `vera_dev` because the runner was pointed at
the dev DB. Added a probe: if any `BackfillRun` has `promoted=true`,
Playwright refuses to start and points the operator at a dedicated test
DB. Override via `PLAYWRIGHT_ALLOW_PROD_DATA_WIPE=1` for the rare case
of intentionally wiping a dev DB. The data was recovered from `vera_prod`
within a few minutes; the guard is forever.

**`e88d6e3` — DB read path live (`USE_DB_DATA_SOURCE=1`).** Dashboards
now read from `vera_prod` at request time, not the build-time JSON
snapshot. Every promoted backfill makes new data visible automatically.
Also shipped in this merge:
- Skeleton loaders for every server-component route.
- Run-now bug fix — derives watermark from `BackfillRun.startedAt`
  rather than only `BackfillSchedule.lastSyncedAt`, so Run-now picks
  incremental mode even when no schedule row exists.
- Write-offs DB-path scope alignment (the JSON file was broadened on
  May 13; the DB path now matches: no AR-only filter, 2024+ install
  cutoff, scope = `all-estimates`).
- `vera_prod` provisioned on GCP Cloud SQL with a scoped `vera_app`
  role; Neon abandoned (quota exhausted).
- `docs/GCP_MIGRATION.md` runbook documenting the migration.

### 2026-05-13 — Write-offs broadened

**`49551d5` (PR #19) — Write-offs scope expanded.** The write-offs
dashboard now surfaces all estimates with an Amount Withheld discount on
or after a 2024 install date, not only those in the AR working set.
Result: 25 records ($139K) → 373 records ($2.26M). A Status filter
(Active AR / Paid off) was added so operators can drill into one or the
other.

**`071b655` — `.vercelignore` excludes `worktrees/`.** A 196 MB
`jobs_dedup.jsonl` inside a worktree was being uploaded with deploys,
hitting Vercel's 100 MB single-file limit. Fixed by excluding the
worktree path.

### 2026-05-12 — Backfill scheduling system

**`811d82e` — QStash-based backfill ticks + atomic promote.** The
backfill pipeline: a `BackfillSchedule` row drives a recurring run; each
run is a chain of QStash ticks that fetches one Rooflink page per tick;
on completion the run flips `promoted=true` and invalidates the
dashboard cache. Run-now ad-hoc triggers use the same machinery with
`scheduleId=null`. Cancellation is atomic and idempotent.

**`df70f25` — Write-offs dashboard.** New page at `/dashboard/write-offs`
listing every estimate with an `Amount Withheld` discount line item.
Reads from `apps/web/data/write-offs.json` at this point (DB path comes
on May 14).

**`569894a` — Customer column + install date.** Both columns added across
Aging, Milestones, Follow-ups, Write-offs. Install date formatted
US-style (MM/DD/YYYY) per UI convention.

### 2026-05-11 — Cron stabilization

**PR #13 — Scheduler natural-key + QStash migration.** Two compounding
bugs fixed in one PR. Scheduler was duplicating rows (every save
inserted a new `Schedule` row, accumulating 11 daily rows for tenant 1
by May 10) — fixed by enforcing `(tenantId, cadence)` as a DB unique
index, rewriting the API as `PUT/DELETE /api/schedules/[cadence]`, and
rebuilding the UI around three explicit states (Unscheduled / Scheduled /
Paused). Cron was unreliable on GitHub Actions (~5% delivery rate) —
migrated to Upstash QStash, which fires within seconds.

### 2026-05-08 — Foundational ship

**PR #5 — Foundational ship.** ~10 commits squashed: multi-tenant auth,
Postgres on Neon (at the time), AI briefing, real scheduling, exit
animations, mobile chip overflow fix, Playwright revival with JWT auth
helper. Most of what's on prod today.

**PR #4 — `fix(chat)`.** Customer-name surface bug + tighter `listJobs`
prompt.

### Earlier

See `git log` for everything prior to PR #4.

---

## Currently on `main` but not deployed

If a commit landed on `main` after the most recent successful production
deploy, list it here. Today: nothing pending — `main` and prod are in
sync as of 2026-05-14 16:53 IST.

---

## Versioning

We don't ship versioned releases (no SemVer tags, no GitHub releases).
The deployed `main` SHA *is* the version.

```bash
# Current prod SHA
vercel ls --prod | head -2

# Compare against local main
git rev-parse origin/main
```

If you need a stable reference for a demo or a customer touchpoint,
capture the SHA in your meeting notes.
