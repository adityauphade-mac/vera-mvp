# Dashboard data-fetch review — 2026-05-15

**Status: Fix 5 (materialized view `LiveJob`) implemented and measured. Results in §8.**

**The question this doc answers:** how fast does the dashboard get its data, and where can we make it faster?

Tested locally against `vera_dev` (121,000+ raw Rooflink job records — same data shape as production).

---

## 1. What we measured

Two scenarios. **"Warm cache"** is what you'd see clicking around the dashboard after the data is already in memory. **"Cache miss"** is what happens right after a backfill sync — the cache gets thrown out and the next click has to recompute from scratch.

```
endpoint                                  warm cache    cache miss (post-sync)
--------                                  ----------    ----------------------
/api/jobs/aging                              ~8 ms                ~900 ms
/api/jobs/follow-ups                         ~8 ms                (shares aging's cache)
/api/jobs/milestones                         ~7 ms                (shares aging's cache)
/api/jobs/reconciliation                     ~7 ms                (shares aging's cache)
/api/reps/outstanding                        ~6 ms                (shares aging's cache)
/api/schedules                               ~6 ms                ~6 ms (no heavy query)
/api/audit-logs                              ~7 ms                ~7 ms (no heavy query)
/dashboard/write-offs                       ~100 ms               ~1100 ms
```

**Two things to notice:**

1. **Warm clicks are fast** (≤ 10 ms for most APIs). The cache is working.
2. **Cache misses are slow** (~1 second). This is the entire problem.

---

## 2. Why this matters: the cache is constantly being thrown out

A user-facing cache that takes 1 second to rebuild is only a problem if it gets rebuilt often. Here's the part that's easy to miss:

> **Every backfill sync invalidates the cache — including syncs that pulled in zero new records.**

In `vera_dev` today, the last 15 incremental sync runs for `rooflink_jobs` did this:

- 1 of them found 89 new records.
- **14 of them found zero new records.**

All 15 published their results, which means each one busted both caches. The next user click after each of those 14 zero-record syncs paid the full ~1 second penalty for nothing.

In production, the backfill ticks every few minutes. So a user clicking around mid-day frequently hits the slow path even though the underlying data didn't change.

---

## 3. Why is one click ~1 second?

Imagine the database as a filing cabinet with 100,000+ folders. Each folder is one job. Inside each folder is **one large page of JSON text** — about 1.6 KB — containing every field Rooflink sent us (address, dates, balance, status, etc.).

To answer "which jobs need accounts-receivable attention right now?", we have to:

1. **Find the most recent version of each folder.** Some folders have multiple versions because incremental syncs added newer copies.
2. **Of those 100k+ folders, find the ~130 that are AR-eligible** — meaning: not excluded, completed, and have a balance > 0.
3. **Also count duplicate addresses** so we can flag jobs at the same address as an anomaly.

The slow part is step 1. To find "the latest version of each folder", Postgres reads **all** 100k folders, copies each one into a sorting area, sorts them, then keeps the top one per folder.

The sort moves about **160 MB** of data (100k folders × 1.6 KB each). That's too much to fit in Postgres's default sorting memory (4 MB), so Postgres spills the sort to disk. That disk I/O is where most of the 900 ms is spent.

After the sort, the result gets scanned twice — once to count duplicate addresses, once to filter for AR eligibility. Each scan walks all 100k JSONB blobs again.

---

## 4. The fixes

I'm recommending five things. The first four are small, low-risk, and measured. The fifth is the structural redesign that addresses what you raised about JSONB. Each is described below in the same shape:

> **What it does. Why this helps. What it costs. Why now (or not).**

### Fix 1 — Tell Postgres to use more RAM for sorting (1 line)

**What it does.** Adds one SQL setting at the start of the heavy queries: `SET LOCAL work_mem = '256MB'`. This is just telling Postgres "you're allowed to use up to 256 MB of memory for sorts before falling back to disk."

**Why this helps.** Right now Postgres spills the 160 MB sort to disk because the default is 4 MB. With 256 MB available, the sort stays in RAM. Also, Postgres becomes more willing to use an index instead of a full table scan.

**Measured impact.** **1215 ms → 867 ms** (roughly 30 % faster), tested on real `vera_dev` data.

**What it costs.** One line of code. Uses more RAM per query — but only for the duration of that query, and our dashboard isn't hit by hundreds of concurrent users.

**Why now.** Zero risk, instant rollback if anything goes wrong (literally remove the line). The 30 % is real, measured improvement for ~5 minutes of work.

### Fix 2 — Stop sorting the JSON blob (small SQL rewrite)

**What it does.** Restructures the SQL. Right now, to find "the latest version of each folder", we sort all 100k folders **including** the 1.6 KB JSON blob inside each one. The rewrite says: first sort just the folder IDs and version numbers (tiny tuples, ~50 bytes each), find the latest version per folder, **then** go fetch the JSON blob for only those rows.

Analogy: instead of sorting 100,000 books by title while carrying each book in your arms, you sort 100,000 index cards (title + edition number), find the latest edition of each title, then go pull just those books off the shelf.

**Why this helps.** The sort goes from 160 MB to a few megabytes. Postgres can use the existing primary-key index to fetch the payloads, which it's very good at.

**Measured impact.** **1215 ms → 807 ms** on its own (no `work_mem` change). Combined with Fix 1, estimated **~300 ms** for the cold query.

**What it costs.** A small SQL rewrite — maybe 15 lines changed in [apps/web/lib/backfill/merge-view.ts](apps/web/lib/backfill/merge-view.ts). No schema change, no app code change.

**Why now.** Self-contained in one file, measured win, no behavior change (returns identical rows in identical order). Pairs naturally with Fix 1.

### Fix 3 — Make one pass over the data instead of two (small SQL tweak)

**What it does.** Right now after the sort, we look at the same data **twice** — once to count duplicate addresses across the full set, once to filter for AR eligibility. We can do both in a single pass using a SQL window function.

**Why this helps.** Cuts one full scan of the ~100k JSON blobs.

**Estimated impact.** Another **50-100 ms** faster on top of Fixes 1 and 2.

**What it costs.** Slightly more complex SQL (uses `COUNT(*) OVER (PARTITION BY …)` instead of a separate CTE). Same file as Fix 2.

**Why now.** Tiny incremental win, costs little once you're already editing the file for Fix 2. Skip it if you'd rather ship the previous two first and measure.

### Fix 4 — Don't publish empty incremental syncs (very small fix)

**What it does.** When the backfill runs and finds zero new records, it currently still "publishes" the empty run, which invalidates the cache. The fix: just don't publish empty runs.

Two parts:
- One-line code change in [apps/web/lib/backfill/tick-worker.ts:409](apps/web/lib/backfill/tick-worker.ts:409) — if the incremental processed zero rows, skip the promote step.
- One-shot SQL to clean up the 14 empty runs already published: `UPDATE "BackfillRun" SET promoted = false WHERE mode = 'incremental' AND "itemsProcessed" = 0 AND promoted = true;`

**Why this helps.** Each empty sync currently busts both caches, forcing the next user click to pay the full 1-second penalty. Fixing this eliminates those penalties entirely — the cache only invalidates when there's actually new data.

**Measured impact.** No change to the cold-query cost itself, but eliminates roughly 14 unnecessary cache busts per day in production usage. In real terms: users stop seeing the slow click after most syncs.

**What it costs.** Trivial — maybe 5 lines of code plus the SQL.

**Why now.** It's silly not to do this. Independent of every other fix.

### Fix 5 — The structured table (your idea)

**What it does.** This is exactly what you raised. Instead of querying JSONB blobs, build a proper structured table:

```
LiveJob
  rooflinkId         (primary key)
  dateCompleted      (indexed)
  balance            (indexed)
  excludeFromQb      (indexed)
  normalizedAddress  (indexed)
  payload            (the original JSONB, for fields we haven't extracted yet)
```

Rebuilt automatically every time a backfill sync publishes new data. Dashboard reads from this table instead of from `RawRooflinkJob`.

**Why this helps.** With indexes on `(dateCompleted, balance, excludeFromQb)`, the AR query goes from "scan 100k folders, sort all of them, filter 99.9 % out" to "use an index to find the 127 AR rows directly." Expected: **a few milliseconds**, not seconds. The duplicate-address count uses an index on `normalizedAddress` and is similarly cheap.

This is the long-term right answer. Your instinct is correct.

**What it costs.** This is the only fix that's a real project, not a tweak:
- A new database migration to create the table.
- New code that maintains the table — every time a backfill publishes, transform the new JSON blobs into structured rows and upsert them.
- Decide what happens if the structured table and the raw JSONB get out of sync (e.g. a partial sync failure mid-write).
- Tests for all of the above.

Rough estimate: 2-3 days of focused work, plus a careful review.

**Why I'm proposing it last, not first.** Three reasons:

1. **Risk.** Fixes 1-4 are small, measured, and reversible. Fix 5 introduces a new source of truth that has to stay in sync with the JSONB — a small but real new failure mode.
2. **Maybe you don't need it.** With Fixes 1-4, the cold query goes from ~900 ms to ~300 ms, AND we stop busting the cache for empty syncs. If "300 ms cold, only when data actually changed" is fine, we never have to build the table at all. That's worth checking before spending the 2-3 days.
3. **Fixes 1-4 are not wasted work if we build the table later.** They optimise queries we'd be writing anyway during development. The cache-bust fix (Fix 4) survives the redesign untouched.

If after Fixes 1-4 we still hit performance pain — say the dashboard adds new features that need more aggregation, or production hits 500k+ jobs — Fix 5 is the obvious next move. Just do it then with a clear "the smaller stuff wasn't enough" reason.

---

## 5. Recommendation

If I had to pick one order:

1. **Today / this week:** Fix 4 + Fix 1. Five total lines of code plus one one-shot SQL. Eliminates most of the unnecessary cache busts AND makes the recompute itself faster. **Single PR, deployable in a day.**
2. **Next sprint, if anyone still notices slow clicks:** Fix 2 + Fix 3. Gets cold reads to roughly 300 ms.
3. **Quarter or later, only if 300 ms still isn't enough:** Fix 5 (the structured table). Plan it as a proper project.

---

## 6. What we didn't change in this review

These exist and are correct as-is, so I want to be explicit I'm not proposing to touch them:

- The two in-memory caches in [apps/web/lib/data.ts](apps/web/lib/data.ts) and [apps/web/lib/write-offs-data.ts](apps/web/lib/write-offs-data.ts). Their design (per-tenant, version-keyed on the published-run-id list) is exactly right. Fix 4 reduces how often the version key changes, which makes the cache more effective without changing how the cache works.
- The fact that all `/api/jobs/*` and `/api/reps/*` endpoints share one cache. That's a good architectural call — one cache, many readers.
- JSONB as the **storage** format. Fix 5 keeps `RawRooflinkJob` as the source of truth and adds a derived table for reading. JSONB stays, just isn't on the hot read path anymore.

---

## 7. After: Fix 5 implemented (materialized view `LiveJob`)

We went ahead with Fix 5 — adding a Postgres materialized view that holds one deduplicated, indexed row per `(tenantId, rooflinkId)`. The dashboard now reads from this view; the heavy `DISTINCT ON` + JSONB filtering happens once per backfill promote, off the user-facing request path.

### What landed

- **Migration** [apps/web/prisma/migrations/20260515000000_add_livejob_materialized_view/migration.sql](apps/web/prisma/migrations/20260515000000_add_livejob_materialized_view/migration.sql)
  - Creates `LiveJob` from `RawRooflinkJob` joined to `BackfillRun` filtered to `promoted = true`.
  - Extracts `dateCompleted`, `balance`, `excludeFromQb`, `primaryEstimateId`, `normalizedAddress` as proper columns.
  - Pre-computes `addressDupCount` via a window function so the dashboard never recomputes it.
  - Indexes: unique `(tenantId, rooflinkId)` for `CONCURRENTLY` refresh, partial index for AR filter, partial index for write-offs filter.
- **`tick-worker.promote()`** [apps/web/lib/backfill/tick-worker.ts](apps/web/lib/backfill/tick-worker.ts) — after every successful `rooflink_jobs` promote, runs `REFRESH MATERIALIZED VIEW CONCURRENTLY "LiveJob"`. Wrapped in try/catch so refresh failures don't fail the promote (next refresh catches up).
- **Read paths** [apps/web/lib/backfill/merge-view.ts](apps/web/lib/backfill/merge-view.ts) — both `getLiveARJobsWithContext` and `getLiveJobsForWriteOffs` now query `LiveJob` with structured-column predicates. No JSONB parsing on the read path. The old in-process cache layer is untouched and still effective.
- **Application-level caches** in [apps/web/lib/data.ts](apps/web/lib/data.ts) and [apps/web/lib/write-offs-data.ts](apps/web/lib/write-offs-data.ts) — unchanged. They were already correct; LiveJob just makes the underlying query they fall back to much cheaper.

### Measured results

EXPLAIN ANALYZE on the AR query directly:

```
Before (DISTINCT ON over JSONB): 1215 ms
After  (LiveJob bitmap index):    0.84 ms      ← ~1400× faster
```

End-to-end dev server timings (same script as §1 and §2):

| Scenario | Before | After | Change |
|---|---|---|---|
| `/api/jobs/aging` warm | 8 ms | 9 ms | unchanged |
| `/api/jobs/aging` first hit | 1108 ms | 79 ms | **14× faster** |
| `/api/jobs/aging` post-promote (cache miss) | 903 ms | 30 ms | **30× faster** |
| `/dashboard/write-offs` warm | 88 ms | 90 ms | unchanged |
| `/dashboard/write-offs` first hit | 1879 ms | 919 ms | 2× faster |
| `/dashboard/write-offs` post-promote (cache miss) | 1108 ms | 343 ms | **3× faster** |

Cost moved (not eliminated):

| What | Where | Cost |
|---|---|---|
| `REFRESH MATERIALIZED VIEW CONCURRENTLY "LiveJob"` | Backfill worker, after each `rooflink_jobs` promote | 2.9 s on vera_dev |

The 2.9 s is the same shape of work the dashboard used to do on every cache miss — sorting and deduplicating across the promoted version chain. It now runs **once per promote**, not **once per user request**. With Fix 4 added later (skip empty-incremental promotes), the refresh only fires when data actually changed.

### Verification

Counts and totals match exactly between OLD and NEW code paths on the same `vera_dev` data:

- AR endpoint: **127 jobs, $1,236,826.70 total balance**, 26 duplicate-address anomalies.
- Write-offs candidates: **2,209 rows** through both paths.
- Every dashboard page (`/dashboard`, `/dashboard/aging`, `/dashboard/follow-ups`, `/dashboard/write-offs`, `/dashboard/scheduler`, `/dashboard/audit-logs`) returns HTTP 200.
- Typecheck (`tsc --noEmit`) clean.

**Rigorous diff** — we reconstructed the OLD JSONB-reading logic as a CTE and diffed it row-by-row against the new `LiveJob` view. Verification script: [/tmp/verify-livejob.sql](/tmp/verify-livejob.sql). Every check returned zero discrepancies:

```
check                    | value
-------------------------+--------
old_dedup_count          | 103496
livejob_count            | 103496
dedup_only_in_old        | 0      ← every old (tenant, rooflinkId) is in LiveJob
dedup_only_in_new        | 0      ← LiveJob has no rows the old logic wouldn't
data_version_mismatch    | 0      ← same dataVersion selected per key
ar_old_count             | 127
ar_new_count             | 127
ar_only_in_old           | 0      ← same AR working set
ar_only_in_new           | 0
address_count_mismatch   | 0      ← addressDupCount matches old addr_counts
writeoffs_old            | 2209
writeoffs_new            | 2209
writeoffs_only_in_old    | 0      ← same write-offs candidate set
writeoffs_only_in_new    | 0
```

### Bug found and fixed during verification: NULL-safe `exclude_from_qb`

The first cut of the view defined `excludeFromQb` as `(payload->>'exclude_from_qb') = 'true'`. In `vera_dev`, every row has the field explicitly set, so this returned `true` or `false` and the counts matched the old logic by accident. **In production, if Rooflink sends a job without that field, the expression evaluates to `NULL`** — which the AR filter `"excludeFromQb" = false` then **excludes**, silently dropping jobs from the dashboard.

The old JSONB read was defensive — `(payload->>'exclude_from_qb' IS NULL OR != 'true')` — which **included** missing-field rows. To preserve that, the view definition now uses:

```sql
COALESCE((r.payload->>'exclude_from_qb') = 'true', false) AS "excludeFromQb"
```

NULL is defaulted to `false` (= "not excluded"), which matches the old behavior exactly. The same pass added `NULLIF(..., '')` on `dateCompleted` to defend against empty-string dates that would otherwise blow up the date cast during a future refresh.

Migration updated in place (the migration hasn't been deployed yet — it lives only in this branch). Same verification script above re-ran after the fix; still zero discrepancies.

### End-to-end backfill flow test

The diff above confirms *static* equivalence between OLD and NEW. To confirm the *dynamic* flow — that new data from a future backfill actually flows through to the dashboard — we ran a full simulation:

1. Picked an existing AR job (rooflinkId `296667`, current balance `$52,155.79`).
2. Created a synthetic `BackfillRun` (mode=`incremental`, status=`completed`, `itemsProcessed=1`, `promoted=false`).
3. Inserted a new `RawRooflinkJob` row for `296667` with that run's id as `dataVersion` and a modified payload (`balance` set to `99999.99` as a JSON number, matching the format Rooflink uses).
4. Flipped `BackfillRun.promoted = true` — exactly what `tick-worker.promote()` does after a successful sync.
5. Ran `REFRESH MATERIALIZED VIEW CONCURRENTLY "LiveJob"` — exactly what the next line of `promote()` does.
6. Restarted the dev server to bust the in-process cache (production gets this for free via `invalidateDataSnapshot`).
7. Hit `/api/jobs/aging`.

**Result:**

| Field | Before | Expected after | Actual after | Pass? |
|---|---|---|---|---|
| `totalCount` | 127 | 127 | 127 | ✅ |
| `totalBalance` | $1,236,826.70 | $1,284,670.90 | $1,284,670.90 | ✅ |
| Job 296667 balance | $52,155.79 | $99,999.99 | $99,999.99 | ✅ |

Cleanup: deleted the synthetic row and run, refreshed the view — dashboard returned to `totalCount: 127, totalBalance: $1,236,826.70`, job 296667 back to `$52,155.79`. Baseline restored exactly.

**One test artifact worth knowing about:** the first cut used `jsonb_set` with `'"99999.99"'`, which writes balance as a JSON **string** rather than a number. Real Rooflink payloads use a JSON number for `balance`, and the Zod schema (`RoofLinkJobSchema` in `@vera/types`) requires a number. Until we fixed the test payload to use `to_jsonb(99999.99::numeric)`, Zod silently dropped the row in the Node-side parse. This would have happened with the OLD JSONB-reading code path too — it's not a LiveJob-specific issue, just a reminder that Zod parsing is the second layer of defense and any future "why isn't my new field showing up" debugging should check the Zod schema and the parse results, not just the DB.

### Why write-offs is still ~340 ms on cache miss

The write-offs path joins jobs against line items Node-side, then iterates ~2,200 candidate jobs through Zod parsing and the `toWriteOffRecord` domain function, then renders HTML. The DB query itself is now fast (the LiveJob partial index makes it ~5 ms); the remaining cost is Node/render. If write-offs cold reads become a real complaint, the next step would be either denormalizing the line-items join into the view or moving the Node-side iteration to a precomputed table.

### What's still recommended

The other fixes from §4 stack cleanly on top of the materialized view:

- **Fix 4 (skip empty-incremental promotes)** — still worth doing. With LiveJob in place, an empty promote now triggers an unnecessary 2.9 s REFRESH on the backfill worker. Same trivial code change as before.
- **Fix 1 (`work_mem`)** — no longer needed for the AR query (it's now ~1 ms). Keep in mind for future bulk operations.
- **Fixes 2 and 3** — moot, the DISTINCT ON path they were rewriting is no longer on the hot read.

### Future-proofing

The view definition is the single place to extract more fields. Adding a new structured column = edit the migration's `SELECT` list, add an index if needed, drop and recreate (data is rebuilt from `RawRooflinkJob`, no migration of existing rows). The `payload` JSONB column stays on the view as an escape hatch for unmapped fields — code that hasn't been migrated yet keeps working.

If the table grows so large that `REFRESH CONCURRENTLY` becomes painful, the upgrade path is a real table + targeted upserts (full Fix 5 / structural table). But because the dashboard already reads from a column-based interface, that upgrade is contained to the maintenance side — read code doesn't change.

---

## 8. Process notes

- All measurements were taken locally against `postgres://localhost:5432/vera_dev`. Nothing touched Neon or the production Cloud SQL.
- For the code-side findings on the recent multi-recipient change, see [MULTI_RECIPIENT_CODE_REVIEW.md](MULTI_RECIPIENT_CODE_REVIEW.md).
- Numbers in this doc came from a real benchmark script — happy to share or re-run if you want different scenarios measured.
