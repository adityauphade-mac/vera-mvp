# Phase A — close out the DB-source cutover on local

> **Retired 2026-05-18.** The `USE_DB_DATA_SOURCE` flag this plan was
> structured around is gone; the DB read path is the only path. Kept
> for historical context. See
> [`../JSON_REMOVAL_PLAN.md`](../JSON_REMOVAL_PLAN.md).

**Goal:** prove the full DB-source cutover (`USE_DB_DATA_SOURCE=1`) works end-to-end against real data, on local Postgres, without touching Neon.

**Status when this plan starts (now):**

- ✅ Both Rooflink fixes applied to `apps/web/lib/backfill/rooflink.ts` (cheap SQL + sort key)
- ✅ Smoke tests passed: cheap-SQL correctness + sort-key throughput
- ✅ Local `vera_dev` has a promoted jobs fixture (run #131, 103,440 rows)
- ⏸ Local has only 346 lineitems rows (partial smoke); needs full backfill
- ⏸ Dashboard routes (the cutover work from earlier) untested against real DB data
- ⏸ Rooflink fixes uncommitted
- ⏸ Cutover code from earlier in session uncommitted
- ⏸ `.env.development.local` override in place (needs cleanup at end)

**End-state we want:**

- Local DB has a fully-promoted lineitems backfill (~8,440 rows)
- Every dashboard route renders correctly with `USE_DB_DATA_SOURCE=1`
- E2E suite passes with flag off (no regression on the JSON path)
- New `dashboard-db-source.spec.ts` passes with flag on
- All code committed and pushed
- Dev override cleaned up

**Estimated total time:** ~5 hours wall-clock (mostly the lineitems backfill running in background).

---

## Step 0 (now, 1 min): start the lineitems backfill in background

This is the long pole — kick it off first, do everything else in parallel.

```bash
# From repo root, dev server already running at localhost:3000 against local DB
DATABASE_URL='postgresql://aditya.uphade@localhost:5432/vera_dev' \
  node scripts/backfill-watch.mjs rooflink_lineitems \
  > /tmp/backfill-watch-local-lineitems.log 2>&1 &

# Note the PID so we can monitor it
```

**Verification:** within 30 sec, `/tmp/backfill-watch-local-lineitems.log` shows `tick POST → 200`.

**Risk:** if dev server crashes or laptop sleeps, the chain breaks. Re-running the watcher resumes from the cursor (idempotent via `skipDuplicates`).

**Time:** ~4.7 hours unattended.

---

## Step 1 (parallel with Step 0, ~30 min): commit the Rooflink fixes

The fixes are in `apps/web/lib/backfill/rooflink.ts`. Commit them as a focused change, separate from the larger cutover work.

### Commit 1.1 — Rooflink performance fixes

Files to include:
- `apps/web/lib/backfill/rooflink.ts` (cheap SQL + sort key)
- `docs/ROOFLINK_BACKFILL_PERFORMANCE.md` (rationale + measurements)
- `docs/UNDERSTANDING_THE_BACKFILL.md` (plain-English explainer)

Files NOT in this commit (separate concerns):
- `scripts/test-cheap-sql.mjs`, `scripts/test-cheap-sql-via-jsonl.mjs`, `scripts/test-cheap-sql-local-pg.mjs`, `scripts/load-jsonl-into-local.mjs` — these are smoke-test tooling, may or may not belong in repo long-term
- `apps/web/.env.development.local` — temporary, deleted at end of Phase A

```bash
git add apps/web/lib/backfill/rooflink.ts
git add docs/ROOFLINK_BACKFILL_PERFORMANCE.md
git add docs/UNDERSTANDING_THE_BACKFILL.md

git commit -m "fix(backfill): cheap SQL for estimate-id loader; date_created sort key

Two perf fixes for the Rooflink backfill, both validated by direct measurement
+ end-to-end local smoke test. See docs/ROOFLINK_BACKFILL_PERFORMANCE.md.

1. loadEstimatesWithTimestamps now extracts ids via Postgres JSON operators
   instead of pulling all ~104k raw payloads. Transfer per call drops from
   ~5 GB to ~150 KB (613x); per-tick wall time from ~30-60s to ~1-2s. This
   was the bug that exhausted Neon's data-transfer quota during run #16.

2. fetchJobsBatch now orders pages by date_created (ASC) instead of
   -date_last_edited. Direct curl measurements: 10.2s vs 19.7s per
   page_size=100 page. ASC by an immutable field is also the safest walk
   order for long-running backfills (new inserts land at the end of the
   cursor, not before it).

Smoke results on local vera_dev:
- lineitems: 346 records in 12 min, 0 errors, ~0.5 estimates/sec (matches
  Rooflink's natural floor)
- jobs: 1,000 records in 90 sec, 0 errors, ~11 jobs/sec
"
```

### Commit 1.2 — supporting scripts (optional, judgment call)

If you want the smoke-test tooling in repo:

```bash
git add scripts/test-cheap-sql.mjs \
        scripts/test-cheap-sql-via-jsonl.mjs \
        scripts/test-cheap-sql-local-pg.mjs \
        scripts/load-jsonl-into-local.mjs \
        scripts/backfill-watch.mjs

git commit -m "tooling: scripts for backfill perf verification and local-fixture load

- backfill-watch.mjs: triggers + tails a backfill run (used during
  Phase A smoke). Can be kept around as an ops aid.
- test-cheap-sql*.mjs: verification scripts for the cheap-SQL fix.
- load-jsonl-into-local.mjs: one-shot loader that turns data/jobs_dedup.jsonl
  into a promoted RawRooflinkJob fixture for local testing."
```

**Decision point:** if these feel one-shot, leave them uncommitted. They're standalone files, easy to delete.

---

## Step 2 (parallel with Step 0, ~30 min): commit the earlier cutover work

This is the larger set of changes from earlier in the session — the actual DB-source cutover. Going to need careful commit-splitting per CLAUDE.md "one commit, one logical change."

### Files involved (from `git status` earlier):
```
M  apps/web/app/api/brief/send/route.ts
M  apps/web/app/api/chat/route.ts
M  apps/web/app/api/cron/dispatch-briefs/route.ts
M  apps/web/app/api/jobs/aging/route.ts
M  apps/web/app/api/jobs/follow-ups/route.ts
M  apps/web/app/api/jobs/milestones/route.ts
M  apps/web/app/api/jobs/reconciliation/route.ts
M  apps/web/app/api/jobs/write-offs/route.ts
M  apps/web/app/api/reps/outstanding/route.ts
M  apps/web/app/dashboard/aging/page.tsx
M  apps/web/app/dashboard/follow-ups/page.tsx
M  apps/web/app/dashboard/layout.tsx
M  apps/web/app/dashboard/milestones/page.tsx
M  apps/web/app/dashboard/page.tsx
M  apps/web/app/dashboard/reconciliation/page.tsx
M  apps/web/app/dashboard/rep-leaderboard/page.tsx
M  apps/web/app/dashboard/write-offs/page.tsx
M  apps/web/lib/backfill/tick-worker.ts   ← cache invalidation hook
M  apps/web/lib/briefing-generator.ts
M  apps/web/lib/data.ts                   ← DB-backed loader behind flag
M  apps/web/lib/write-offs-data.ts        ← same pattern
M  scripts/fetch-write-offs.ts            ← uses new shared domain fn
M  shared/domain/package.json             ← +zod
M  shared/domain/src/index.ts             ← exports write-offs domain fn
M  tests/e2e/api.spec.ts                  ← signInAs wiring
?? apps/web/lib/backfill/error-display.ts ← sanitizer
?? shared/domain/src/write-offs.ts        ← new domain module
?? tests/e2e/dashboard-db-source.spec.ts  ← new spec
?? docs/AR_BACKLOG.md
?? docs/DATA_SOURCE_MIGRATION.md
```

Proposed commit split:

### Commit 2.1 — write-offs domain module + script refactor

```bash
git add shared/domain/src/write-offs.ts \
        shared/domain/src/index.ts \
        shared/domain/package.json \
        scripts/fetch-write-offs.ts

git commit -m "feat(domain): extract write-off detection into shared module

Single source of truth for product_id=71493 (Amount Withheld) detection.
Both scripts/fetch-write-offs.ts and the upcoming DB-backed write-offs
loader call the same toWriteOffRecord(job, payload) function.

Adds zod as a direct dep of @vera/domain (was already transitive via
@vera/types but the new module references it directly)."
```

### Commit 2.2 — DB-backed data loaders behind flag

```bash
git add apps/web/lib/data.ts \
        apps/web/lib/write-offs-data.ts

git commit -m "feat(data): DB-backed dashboard reads behind USE_DB_DATA_SOURCE flag

getData() and getWriteOffs() now dispatch based on USE_DB_DATA_SOURCE:
- flag off (default): bundled JSON snapshots — unchanged behavior
- flag on: read promoted RawRooflinkJob / RawRooflinkLineItems rows,
  transform via @vera/domain at request time, return same shapes

Cached per (tenantId, promoted-run-ids) in-process. Cache invalidates
naturally on promote (different run-id set). Adds:
- getDataForCurrentSession() / getWriteOffsForCurrentSession() helpers
  for server components
- invalidateDataSnapshot() / invalidateWriteOffsSnapshot() for tick-worker
  to call after promote"
```

### Commit 2.3 — wire tenantId through API routes and pages

```bash
git add apps/web/app/api/jobs/aging/route.ts \
        apps/web/app/api/jobs/milestones/route.ts \
        apps/web/app/api/jobs/follow-ups/route.ts \
        apps/web/app/api/jobs/reconciliation/route.ts \
        apps/web/app/api/jobs/write-offs/route.ts \
        apps/web/app/api/reps/outstanding/route.ts \
        apps/web/app/api/chat/route.ts \
        apps/web/app/api/brief/send/route.ts \
        apps/web/app/api/cron/dispatch-briefs/route.ts \
        apps/web/app/dashboard/aging/page.tsx \
        apps/web/app/dashboard/follow-ups/page.tsx \
        apps/web/app/dashboard/layout.tsx \
        apps/web/app/dashboard/milestones/page.tsx \
        apps/web/app/dashboard/page.tsx \
        apps/web/app/dashboard/reconciliation/page.tsx \
        apps/web/app/dashboard/rep-leaderboard/page.tsx \
        apps/web/app/dashboard/write-offs/page.tsx \
        apps/web/lib/briefing-generator.ts

git commit -m "feat(routes): thread tenantId through metrics + briefing surfaces

All five metrics routes now wrap in withAuth() and call
await getData(tenantId). Server pages call getDataForCurrentSession()
which resolves tenantId from the session.

Chat/brief/cron-dispatch routes thread tenantId through SendBriefInput
so cron-scheduled briefs scope to the right tenant.

No behavior change with the flag off; opens the door for flag-on."
```

### Commit 2.4 — tick worker: cache invalidation + sanitized errors

```bash
git add apps/web/lib/backfill/tick-worker.ts \
        apps/web/lib/backfill/error-display.ts

git commit -m "feat(backfill): invalidate dashboard cache on promote; sanitize errors

After tick-worker.promote() succeeds, call invalidateDataSnapshot() and
invalidateWriteOffsSnapshot() for the tenant. Dashboard renders fresh
data on the next request without waiting for a cold start.

Also adds lib/backfill/error-display.ts: sanitizeBackfillError() collapses
Prisma stack traces / build paths into one-sentence operator-readable
summaries, applied at the two error-capture sites in tick-worker. Closes
the violation of CLAUDE.md hard rule #12 (no internal identifiers in
user-facing strings)."
```

### Commit 2.5 — e2e support: auth on metrics API + new DB-source spec

```bash
git add tests/e2e/api.spec.ts \
        tests/e2e/dashboard-db-source.spec.ts \
        package.json \
        pnpm-lock.yaml

git commit -m "test(e2e): signInAs on metrics API; new DB-source spec; pg dep

- api.spec.ts now uses signInAs(context) since the five metrics routes
  are auth-gated. Adds a 401 negative-path test.
- dashboard-db-source.spec.ts: self-skipping spec that seeds a known
  RawRooflinkJob fixture and asserts the dashboard surfaces it when
  USE_DB_DATA_SOURCE=1 is set on the server.
- pg + @types/pg added as root devDependencies for the spec's DB seeding."
```

### Commit 2.6 — docs

```bash
git add docs/AR_BACKLOG.md \
        docs/DATA_SOURCE_MIGRATION.md

git commit -m "docs: AR backlog (P0 cutover scope) and migration plan

Both docs were drafted earlier in the session and tracked as untracked
files. Committing them now since they reflect the actual P0 scope and
the architectural plan being executed."
```

---

## Step 3 (when Step 0 finishes, ~5 min): promote the lineitems run

After ~4.7 hours, `/tmp/backfill-watch-local-lineitems.log` should show:

```
[t+...] #133 completed processed=8440/8440 (100.0%) rows-in-db=8440 errs=0/0 cursor=none
-- Run terminal state --
```

If the run promoted itself (status=completed, promoted=true), great. If not:

```bash
# Manually promote so the merge view picks it up
/opt/homebrew/opt/postgresql@15/bin/psql -U aditya.uphade -h localhost -d vera_dev <<'SQL'
-- demote any prior promoted lineitems run
UPDATE "BackfillRun" SET promoted = false
WHERE source = 'rooflink_lineitems' AND promoted = true AND id != 133;
-- promote ours
UPDATE "BackfillRun" SET promoted = true, status = 'completed'
WHERE id = 133;
SQL
```

**Verification:**

```bash
/opt/homebrew/opt/postgresql@15/bin/psql -U aditya.uphade -h localhost -d vera_dev <<'SQL'
SELECT id, source, status, promoted, "itemsProcessed"
FROM "BackfillRun"
WHERE id = 133 OR (source = 'rooflink_lineitems' AND promoted = true);
SELECT COUNT(*) FROM "RawRooflinkLineItems" WHERE "dataVersion" = 133;
SQL
```

Expect: run #133 is promoted, ~8,440 rows on dataVersion=133.

---

## Step 4 (~30 min): flip the flag and walk every dashboard route

Edit `apps/web/.env.development.local` to add the flag:

```
DATABASE_URL=postgresql://aditya.uphade@localhost:5432/vera_dev
USE_DB_DATA_SOURCE=1
```

Restart the dev server:

```bash
pkill -TERM -f "next dev --port 3000"
sleep 2
pnpm dev > /tmp/vera-dev-local.log 2>&1 &
# wait for "Ready in"
until grep -q "Ready in" /tmp/vera-dev-local.log; do sleep 1; done
```

Then sign in via browser (Google OAuth, your existing dev user) and walk every route:

| Route | What to verify |
|---|---|
| `/dashboard` | Briefing card renders; metric tiles show real numbers (Total AR, Critical, Hot, Fell through); Heat distribution donut populated; "Top three" list shows real jobs |
| `/dashboard/aging` | Bucket counts non-zero; table has rows; filter by bucket changes results |
| `/dashboard/milestones` | Table has rows; missing-milestones counts present |
| `/dashboard/follow-ups` | Hot + Critical bands populated; heat scores look reasonable |
| `/dashboard/reconciliation` | "Fell through cracks" list — may be small but should have entries |
| `/dashboard/rep-leaderboard` | Per-rep rollups; sorted by dollars by default |
| `/dashboard/write-offs` | Page renders; ~130 AR-set write-off records; sample row → detail sheet works |
| `/dashboard/audit-logs` | Recent rows visible (includes the promote we just did, plus the dev session) |
| `/dashboard/scheduler` | Backfill cards show run #131 (jobs) and #133 (lineitems) as last completed |

**Red flags to watch for:**
- 500 errors in network tab → check `/tmp/vera-dev-local.log`
- "totalAR = 0" anywhere → cheap SQL or transform broke
- Empty tables when DB has rows → tenantId mismatch
- 401 on metrics routes → withAuth wiring problem

If anything breaks, the dev log tail will say why.

---

## Step 5 (~20 min): run the e2e suite (flag off, no regression)

**Important:** the e2e global-setup wipes `RawRooflinkJob`, `RawRooflinkLineItems`, `BackfillRun`, etc. tables. That will destroy the fixture we just spent 4.7 hours building.

Options:
- **5.a** Run e2e with flag off; accept that fixture is wiped. **Re-run `node scripts/load-jsonl-into-local.mjs` after** to restore.
- **5.b** Skip the e2e regression check on local; do it on production after the cutover code lands but before the flag flips.

I lean toward 5.b — running e2e on local consumes the fixture and then we'd need to re-load + re-promote + re-walk routes. The JSON-path code is unchanged in behavior; running e2e on prod CI gives the same coverage.

If you choose 5.a:

```bash
# Make sure flag is off for the regression run
sed -i '' 's/^USE_DB_DATA_SOURCE=1/# USE_DB_DATA_SOURCE=1/' apps/web/.env.development.local

# Run the suite (excludes the new dashboard-db-source spec since it self-skips)
pnpm test:e2e 2>&1 | tee /tmp/e2e-output.log
```

Expect: all specs pass except `dashboard-db-source.spec.ts` (self-skipped because flag is off).

If 5.a wipes the data, restore:

```bash
node scripts/load-jsonl-into-local.mjs
# Then re-run lineitems backfill (4.7 hr again) OR accept partial state
```

---

## Step 6 (~15 min): cleanup

After Steps 3-5 all pass:

```bash
# Remove the temporary dev override
rm apps/web/.env.development.local

# Verify nothing else references it
grep -r '\.env\.development\.local' . --exclude-dir=node_modules --exclude-dir=.next | grep -v "^docs/"

# Restart the dev server cleanly (now it'll use .env.local → Neon)
pkill -TERM -f "next dev --port 3000"
sleep 2
# Don't auto-restart; the Phase A work is complete
```

Stop any leftover watcher processes:

```bash
pkill -f "backfill-watch.mjs" 2>/dev/null
```

Final git push:

```bash
git push origin feat/db-data-source-cutover
# or whichever branch the work lives on
```

---

## Definition of "done" for Phase A

All of:

- [ ] Lineitems backfill #133 completed and promoted on local (8,440 rows)
- [ ] All 6 commits from Step 1 + Step 2 in git history, clean working tree
- [ ] All 8 dashboard routes verified manually with `USE_DB_DATA_SOURCE=1` against local DB
- [ ] (Optional) E2E suite passes with flag off (no JSON-path regression)
- [ ] `.env.development.local` removed
- [ ] No leftover watcher / dev-server processes from the test session

After this, Phase B (deploying to production once Neon is back) is a straight `vercel --prod` + run prod backfills + flip prod env flag. No further dev work required.

---

## Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Lineitems run dies mid-way (laptop sleeps, dev server crashes) | medium | `caffeinate -dimsu &`; restart watcher (resumes from cursor) |
| Rooflink throttles harder over 5-hour run | low-medium | Backoff is built into the tick worker; worst case it goes slower, not failed |
| Dashboard route fails when flag is on (e.g. tenantId not threaded somewhere) | low | Surfaces in Step 4; dev log + network tab show the bug; fix in-session |
| Commit conflicts because changes interweave | low | Commits are by file group; if a file needs splitting across two commits, use `git add -p` |
| E2E global-setup wipes the fixture we built | guaranteed | Skip e2e on local (option 5.b) or accept the re-load cost |

---

## What's NOT in Phase A

Explicitly out of scope:

- **Production deploy** — that's Phase B
- **GCP Postgres migration** — separate effort, Phase C
- **Fixing the watcher's timestamp display bug** — already in the spawned-task list, not blocking
- **Running real Rooflink jobs backfill** against local — we have the JSONL fixture; full re-fetch from Rooflink for jobs adds 2.6 hr and no new information
- **Updating the migration doc** with the measured numbers — could fold into Step 2.6 docs commit, judgment call
