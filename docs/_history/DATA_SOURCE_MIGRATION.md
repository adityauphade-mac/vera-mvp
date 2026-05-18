# Data Source Migration — `generated.json` → Neon DB

> **Retired 2026-05-18.** The JSON read path was removed entirely (see
> [`../JSON_REMOVAL_PLAN.md`](../JSON_REMOVAL_PLAN.md)). The Neon target
> was also superseded by GCP Cloud SQL (see
> [`../GCP_MIGRATION.md`](../GCP_MIGRATION.md)). Kept for historical
> context only — none of the env flags or fallback paths described
> below exist in the live codebase.

**Status:** Pre-work. Nothing in this doc has been implemented; this is the brief for the cutover.

**Audience:** Anyone (human or Claude) about to touch the dashboard read path or the backfill pipeline.

**Last updated:** 2026-05-12

---

## TL;DR

The five AR dashboard features (Aging & Anomalies, Milestones, Follow-ups, Rep Leaderboard, Reconciliation) currently read from a **build-time static file** (`apps/web/data/generated.json`). They do **not** read from the database. Backfills already populate the DB (raw Rooflink payloads, versioned per run, with a `promoted` flag for atomic swap), but no read path uses them yet. The infrastructure for the cutover is half-built and waiting.

The goal: every backfill that promotes a new snapshot should be the *only* thing that changes what the dashboard shows. No build step, no static file, no pinned demo date.

---

## Current state

### How a dashboard page actually gets its data today

1. User opens `/dashboard/aging`.
2. The page (or its API route, e.g. `GET /api/jobs/aging`) calls `getData()` from [apps/web/lib/data.ts:6](apps/web/lib/data.ts:6).
3. `getData()` returns a cached parse of `generated.json` — which was *imported as a module* at build time:

   ```ts
   // apps/web/lib/data.ts
   import generatedJson from '@/data/generated.json';
   ```

4. That JSON file was produced by [scripts/preprocess.ts](scripts/preprocess.ts) on someone's laptop, before `next build`, by streaming the 188 MB `data/jobs_dedup.jsonl` export, filtering to the AR working set, computing aging/heat/anomalies, and writing the slim result to `apps/web/data/generated.json`.

5. **"Today" is hardcoded** in the preprocess script:

   ```ts
   // scripts/preprocess.ts:29
   const now = new Date('2026-05-05T00:00:00Z'); // pinned "today" for deterministic demo
   ```

   So aging buckets, heat scores, and "days since X" values are all computed against May 5, 2026, regardless of when you load the dashboard.

### Five routes, one source

All read paths in `apps/web/app/api/` go through `getData()`:

| Route | File | Reads |
|---|---|---|
| `/api/jobs/aging` | `apps/web/app/api/jobs/aging/route.ts:18` | `generated.json` |
| `/api/jobs/milestones` | `apps/web/app/api/jobs/milestones/route.ts:14` | `generated.json` |
| `/api/jobs/follow-ups` | `apps/web/app/api/jobs/follow-ups/route.ts:16` | `generated.json` |
| `/api/jobs/reconciliation` | `apps/web/app/api/jobs/reconciliation/route.ts:5` | `generated.json` |
| `/api/reps/outstanding` | `apps/web/app/api/reps/outstanding/route.ts:18` | `generated.json` |

Zero Prisma queries on the read path. Search the codebase: there are no `db.rawRooflinkJob.findMany` calls in any user-facing route today.

### What `backfill.py` does today

`backfill.py` (Python, root of repo) is a **standalone fetcher**, separate from the web app. It calls the Rooflink REST API at 1 req/sec, appends raw payloads to `data/jobs.jsonl`, and saves resume state to `data/cursor.txt`. It does **not** write to the DB. It does **not** trigger a `pnpm preprocess`. It is essentially a manual collection tool used to gather the JSONL we then preprocess. Nothing about it reaches the dashboard.

### Why this is a problem

- Re-syncing data means: run `backfill.py` → dedup → run `pnpm preprocess` → `git commit generated.json` → deploy. The DB is bypassed entirely.
- "Today" is May 5, 2026, forever. Aging cannot age.
- The `BackfillSchedule` / `BackfillRun` system that exists in the DB is invisible to the dashboard — running a backfill changes nothing the user sees.
- Two parallel data lineages (Python script → JSONL → preprocess vs. TS tick worker → DB) is twice the maintenance and one of them is unobserved.

---

## What already exists in the target architecture

A surprising amount. The cutover is wiring, not greenfield.

### Prisma models — already in [apps/web/prisma/schema.prisma](apps/web/prisma/schema.prisma)

- **`BackfillSchedule`** — one row per `(tenantId, source)`. Cadence + timezone + nextRunAt. Source is `'rooflink_jobs'` or `'rooflink_lineitems'`.
- **`BackfillRun`** — one execution. Tracks status (`queued|running|completed|canceled|failed`), mode (`full|incremental`), cursor, items processed, error counts, and crucially: `promoted: boolean` — the atomic-swap flag. The latest *promoted* completed run is "live."
- **`RawRooflinkJob`** — raw payload per `(rooflinkId, dataVersion)`. `dataVersion = BackfillRun.id`. Verbatim API response, kept as-is.
- **`RawRooflinkLineItems`** — same shape, for estimate line items.

This means: every backfill creates a new immutable version of the raw data. Promoting a run swaps the live snapshot atomically. Old versions stay around for diffing and rollback.

### Tick worker — already in [apps/web/lib/backfill/tick-worker.ts](apps/web/lib/backfill/tick-worker.ts)

QStash-driven, claims runs optimistically (so duplicate deliveries can't double-process), fetches a batch from Rooflink, writes raw rows, advances the cursor, and on exhaustion **promotes the dataVersion and demotes prior versions of the same source**. Errors are tracked; two consecutive failures fail the run.

### Merge view — already in [apps/web/lib/backfill/merge-view.ts](apps/web/lib/backfill/merge-view.ts)

`getLiveJobs(tenantId)` and `getLiveLineItems(tenantId)` return the latest live snapshot — one row per natural key, picked across all promoted runs (full + incrementals). Already written, already correct. The file's own doc-comment flags it:

> NOTE: this module is NOT yet wired into the dashboard API routes — those still read `generated.json`. It's the foundation for the JSON-to-DB cutover work, kept here so the incremental sync changes don't depend on that cutover landing first.

### Domain transform — already in [shared/domain/src/transform.ts](shared/domain/src/transform.ts)

`toARJob(rawRoofLinkJob, { addressCounts, now })` converts a raw Rooflink payload into the slim `ARJob` shape the dashboard consumes — applying aging, heat score, anomalies, milestone flags, reconciliation logic. The preprocess script already uses it. The DB read path can use the same function.

### What this means

The shape `getData()` returns today — `{ generatedAt, asOf, jobCount, totalAR, jobs[], reps[] }` — can be reproduced from the DB by:

1. `getLiveJobs(tenantId)` → array of raw Rooflink payloads.
2. Map each payload through `toARJob(payload, { addressCounts, now: new Date() })`.
3. `repRollups(arJobs)` for the leaderboard.
4. Aggregate `totalAR`, `jobCount`, etc.

That's the entire transform. It is the same one the preprocess script runs — just done at request time against fresh DB rows instead of at build time against a static file.

---

## The gap — what's missing

Five concrete pieces of work, in dependency order.

### 1. A DB-backed `getData()` replacement

Today's `lib/data.ts` has no tenant concept and no async signature — it parses the bundled JSON synchronously. The new function needs:

- A `tenantId` parameter (already available everywhere via `withAuth`'s audit context).
- `async` signature — the routes already `await` their parse work, so adding `await` to `getData(tenantId)` is cheap.
- The body roughly:

  ```ts
  // apps/web/lib/data.ts (target shape)
  export async function getData(tenantId: number): Promise<GeneratedData> {
    const rawJobs = await getLiveJobs(tenantId);
    const now = new Date();
    const addressCounts = computeAddressCounts(rawJobs);
    const jobs = rawJobs
      .map((r) => RoofLinkJobSchema.parse(r.payload))
      .filter(isInARWorkingSet)
      .map((j) => toARJob(j, { addressCounts, now }));
    return {
      generatedAt: new Date().toISOString(),
      asOf: now.toISOString(),
      jobCount: jobs.length,
      totalAR: jobs.reduce((s, j) => s + j.balance, 0),
      jobs,
      reps: repRollups(jobs),
    };
  }
  ```

- A cache. Recomputing this on every request is wasteful — the source data only changes when a backfill promotes. The right cache key is the latest promoted `BackfillRun.id` for the tenant's `rooflink_jobs` source. Implementation options:
  - **Module-level Map keyed on (tenantId, promotedRunId)** — simple, in-process, works inside a single Fluid Compute instance. Cleared on every cold start.
  - **Vercel Runtime Cache with tag `backfill:${tenantId}`** — shared across instances in a region. Invalidated when a run promotes (the tick worker calls `updateTag`).
  - Start with the in-process Map. Move to Runtime Cache only if cold-start cost gets noticeable. Don't over-engineer the first cut.

### 2. Plumbing `tenantId` into the five routes

Each route signature changes from `GET(req)` to something that resolves the tenant from the session. The auth helper already does this — the routes need to *use* it. Today they don't because they don't need to (`generated.json` is single-tenant). Routes affected: `aging`, `milestones`, `follow-ups`, `reconciliation`, `reps/outstanding`. About 30 minutes of mechanical change.

### 3. Invalidation on promote

When `tick-worker.ts` flips a run to `promoted: true` and demotes the prior, it should signal "the dashboard's view of this tenant just changed." Options:

- **In-process cache**: nothing extra needed; the next request that lands on a fresh instance will recompute. Slightly stale on instances that were warm before promote.
- **Runtime Cache tag**: call `revalidateTag(\`backfill:${tenantId}\`)` (or the Vercel Runtime Cache equivalent — see `vercel:runtime-cache` skill) at the end of the promote transaction. Invalidates instantly across all instances.

Pick based on the cache decision in step 1.

### 4. "Today" becomes real

`scripts/preprocess.ts:29` hardcodes `now = 2026-05-05`. In the DB path, `now = new Date()` at request time. **This will change every aging bucket and heat score** the moment we cut over. Before merging, run the dashboard against fixture DB data and compare to the current `generated.json` output — confirm the deltas are time-progression only, not bugs. This is the single behavioral change with the highest risk of "looks wrong" feedback from the user.

### 5. Retire the static path (or leave it as a fallback)

Two ways to land this:

- **Feature flag** (`USE_DB_DATA_SOURCE=1`). Ship both paths, flip the flag, watch for regressions, then delete the static path in a follow-up. Safer.
- **Hard cutover.** Delete the import, replace the function body, ship. Faster but no rollback without a revert. Acceptable if the demo data in DB is verified equivalent first.

`backfill.py` and `scripts/preprocess.ts` should stay in the repo for a release or two — they're useful for re-seeding a fresh DB from the original JSONL export. Mark them as "seed tooling, not part of the prod data path" in a comment at the top of each.

---

## Target state — what we want

```
Rooflink API
     │
     │ (1 req/sec, via tick worker on QStash schedule)
     ▼
RawRooflinkJob (Neon, versioned per BackfillRun.id)
     │
     │ promoted run → live snapshot
     ▼
getLiveJobs(tenantId)  ── merge-view.ts
     │
     │ RoofLinkJobSchema.parse + isInARWorkingSet + toARJob(now=new Date())
     ▼
ARJob[] + reps[] (computed at request time, cached per promoted run)
     │
     ▼
Five API routes → Dashboard
```

**Invariants once we're there:**

- Every read on the dashboard goes through `getData(tenantId)`.
- `getData(tenantId)` is the only place that knows about raw payloads. Everything downstream sees `ARJob[]`.
- A backfill completing → promoting is the *only* event that changes what users see. No build, no commit.
- "Today" is today.
- Multi-tenancy works: tenant A's dashboard shows tenant A's snapshot only.

---

## Migration plan

| # | Task | Files | Verification |
|---|---|---|---|
| 1 | Verify a tenant has a promoted `BackfillRun` with non-empty `RawRooflinkJob` rows. If not, run a backfill to seed. | `apps/web/lib/backfill/*` | `db.rawRooflinkJob.count({ where: { dataVersion: <promoted run id> } })` returns > 0 |
| 2 | Add `getDataFromDb(tenantId)` next to existing `getData()`. Same return type. | `apps/web/lib/data.ts` | Unit-ish call: `(await getDataFromDb(1)).jobCount` matches `getData().jobCount` within tolerance for date drift |
| 3 | Thread tenant into the five routes (via `withAuth` or equivalent). Keep `getData()` static for now — just unblock the signature. | five route files in `apps/web/app/api/` | Existing Playwright specs still pass |
| 4 | Add a behind-flag switch: `process.env.USE_DB_DATA_SOURCE === '1'` picks `getDataFromDb`; otherwise `getData`. | `apps/web/lib/data.ts` | Flip flag locally, dashboard renders; flip off, dashboard still renders |
| 5 | Cache layer (in-process Map keyed on promoted run id). | `apps/web/lib/data.ts` | Second request to the same route logs a cache hit |
| 6 | Tick worker signals invalidation on promote. (Skip if using in-process Map only.) | `apps/web/lib/backfill/tick-worker.ts` | Trigger a manual promote, observe stale cache cleared |
| 7 | Run a backfill end-to-end in production with the flag *off*, then turn the flag *on*. Compare dashboard before/after; deltas should be only "now"-driven. | n/a | Visual diff |
| 8 | Delete the static `import generatedJson` from `lib/data.ts`. Remove the flag. Mark `preprocess.ts` and `backfill.py` as seed tooling. | `apps/web/lib/data.ts`, both scripts | `pnpm typecheck && pnpm test:e2e` green |
| 9 | Playwright: add a spec that mocks the DB to return a known fixture and asserts the dashboard renders fixture values. Pin behavior. | `tests/e2e/dashboard-db-source.spec.ts` | Spec passes |
| 10 | Audit row on promote. The category likely already exists (`backfill`); ensure `recordAudit` fires when a run is promoted, with summary like "Promoted backfill run #N — 12,438 jobs live." | `tick-worker.ts` | New row appears in `/dashboard/audit-logs` after a promote |

Rough effort: 1–2 days of focused work for one person. Most of the risk is in step 7 (the "today" behavioral change) and step 1 (do we actually have promoted DB data to read?).

---

## Risks and open questions

1. **Is there a promoted run in production today?** If the DB is empty or no run has ever been promoted, step 1 is "kick off a real backfill and wait for it to complete," which is its own can of worms (rate limits, full sync of 103k jobs at 1 req/sec ≈ 17 minutes).
2. **Demo data parity.** The pinned `now = 2026-05-05` was chosen so the demo always shows the same aging buckets. Once "today" is real, aging buckets will drift forward. If a stakeholder demos with a screenshot from last week, the numbers won't match. Worth flagging before cutover.
3. **Anomaly detection cost.** `detectAnomalies(job, allJobs)` is O(n²) in the worst case. Today it runs once at build time; in the DB path it runs per request (cached). For ~12k AR jobs this should still be sub-100ms, but worth measuring.
4. **Address counts.** The preprocess builds a `Map<address, count>` from *all* RoofLink jobs (the 100k+ set), not just the AR working set. We need to confirm the DB raw rows include the full population, not a pre-filtered subset, or the duplicate-address anomaly will under-fire.
5. **Multi-tenant scoping.** Today's `RawRooflinkJob` schema does not include `tenantId` directly — it's joined via `BackfillRun.tenantId`. The merge view handles this. Sanity-check that `getLiveJobs(tenantId)` never leaks rows across tenants once a second tenant exists.
6. **Cache invalidation lag in dev.** If you're running multiple dev servers (canonical repo + worktree) hitting the same Neon DB, in-process caches will fall out of sync on a promote. Not a prod problem; do mention it in `docs/ONBOARDING.md` when this lands.

---

## What stays out of scope for the cutover

- Changing the API response shapes. The five routes keep their current JSON contracts; only the data origin moves.
- Changing the domain logic (`shared/domain/*`). Same functions, same behavior.
- Building a UI to trigger backfills on demand. That UI already exists; we're just hooking its output up to the read path.
- Replacing `backfill.py` with a TypeScript equivalent. Leave it as the seed tool until V2.

---

## See also

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — overall system map.
- [docs/BACKFILL_SCHEDULING.md](docs/BACKFILL_SCHEDULING.md) — how backfills are scheduled and run.
- [docs/DATA_MODEL.md](docs/DATA_MODEL.md) — Prisma schema rationale.
- `CLAUDE.md` — the hard rules. Note: hard rule #5 ("no autosend without explicit human intent") does not apply here; this is a read-path change, not an outbound action.
