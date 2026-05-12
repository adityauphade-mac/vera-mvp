# Backfill scheduling — design

**Status:** draft, awaiting tech-lead review.
**Owner:** adityauphade-mac
**Last updated:** 2026-05-11

---

## 1. Goal

Replace the build-time JSONL pipeline (`data/jobs_dedup.jsonl` → `generated.json` → UI) with
a Neon-backed pipeline that:

1. Backfills Rooflink data directly into Postgres on a schedule the operator controls
   from the existing `/dashboard/scheduler` page.
2. Lets the operator trigger an ad-hoc "Run now" backfill from the same page.
3. Serves the UI from Neon (read directly from Prisma) instead of the static JSON file,
   so the UI is current to the last successful backfill instead of the last build.

This brings two new data sources online:

- **Rooflink jobs** — the existing [backfill.py](../backfill.py) bulk-list fetch
  (~103k rows, ~17 min wall time).
- **Rooflink estimate line items** — the per-estimate breakdown described in
  the "Important Estimates" doc (~8,492 rows, ~2h 22min wall time at the 1 req/sec
  Rooflink rate limit).

Both share the same execution and scheduling machinery defined below.

---

## 2. Non-goals (V1)

These are deliberately deferred to V2 to keep the V1 surface area small. None of
the V1 schema decisions foreclose them.

- **Incremental sync via `date_last_edited`.** V1 is always a full re-fetch. V2
  adds a `since` field and a "delta only" toggle.
- **Multi-tenant Rooflink credentials.** V1 uses one `RL_KEY` shared across all
  tenants (the schema still carries `tenantId` for V2 readiness — defaulted to
  tenant 1).
- **Per-tick retry of transient errors via QStash native retry.** V1 uses
  in-tick retry only (see §7).
- **Real-time progress updates via WebSocket / Pusher / SSE.** V1 polls every
  5–10s while a run is visibly in progress (Vercel Hobby cannot host
  persistent socket connections — see §6.3).

---

## 3. Architecture overview

```
                              ┌──────────────────────────────┐
       ┌─── "Run now" ──────► │  POST /api/backfills/        │
       │                      │       :source/runs           │
       │                      │  (creates BackfillRun row,   │
       │                      │   publishes first tick)      │
       │                      └────────────┬─────────────────┘
       │                                   │
   ┌───┴────────┐                          │
   │ Scheduler  │                          ▼
   │  page      │                ┌─────────────────────────┐
   │ (UI)       │                │   QStash queue          │
   └───┬────────┘                │   (Hobby tier,          │
       │                         │    ~170 msgs/run)       │
       │                         └────────────┬────────────┘
       │                                      │
       │  GET /api/backfills/active  ◄─poll   │
       │                                      ▼
       │                         ┌─────────────────────────┐
       │                         │ POST /api/cron/         │
       │                         │      backfill-tick      │
       │                         │  ┌───────────────────┐  │
       │                         │  │ claim run         │  │
       │                         │  │ fetch N estimates │  │
       │                         │  │ write raw JSONB   │  │
       │                         │  │ write normalized  │  │
       │                         │  │ advance cursor    │  │
       │                         │  │ publish next tick │  │
       │                         │  └───────────────────┘  │
       │                         └────────────┬────────────┘
       │                                      │
       │                                      ▼
       │                              ┌───────────────┐
       └─── reads via Prisma ─────────│  Neon DB      │
                                       └───────────────┘

       ┌─── Schedule "due" ─────────► QStash cron (every 15min)
       │                              POST /api/cron/dispatch-due
       │  (replaces /dispatch-briefs)
       │
   ┌───┴────────────┐
   │  Schedule +    │   ── dispatch-due fans out to ──►  email send
   │  BackfillSch.  │                                    backfill kickoff
   │  rows          │
   └────────────────┘
```

Two trigger paths (Run-now and scheduled) funnel into the **same**
`BackfillRun` row. The tick worker is identical regardless of how it was kicked
off.

---

## 4. Schema changes

Additions to [apps/web/prisma/schema.prisma](../apps/web/prisma/schema.prisma).

### 4.1 `BackfillSchedule` — mirrors `Schedule`

```prisma
model BackfillSchedule {
  id          Int       @id @default(autoincrement())
  tenantId    Int
  /// 'rooflink_jobs' | 'rooflink_lineitems'
  source      String
  /// 'daily' | 'weekly' | 'monthly'
  cadence     String
  /// 0 (Sunday) .. 6 (Saturday) for weekly cadence
  dayOfWeek   Int?
  /// '1'..'28' or 'last' or 'last-business' for monthly cadence
  dayOfMonth  String?
  /// 'HH:mm' in the tenant's local timezone
  timeLocal   String
  /// IANA tz, e.g. 'America/Chicago'
  timezone    String
  enabled     Boolean   @default(true)
  nextRunAt   DateTime?
  lastRunAt   DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  tenant      Tenant    @relation(fields: [tenantId], references: [id])
  runs        BackfillRun[]

  @@unique([tenantId, source])
  @@index([tenantId, enabled, nextRunAt])
}
```

Mirrors `Schedule`: one row per (tenant, source), edited in place, never duplicated.

### 4.2 `BackfillRun` — one row per execution

```prisma
model BackfillRun {
  id              Int       @id @default(autoincrement())
  tenantId        Int
  source          String
  /// nullable — manual Run-now has no schedule
  scheduleId      Int?
  /// 'queued' | 'running' | 'completed' | 'canceled' | 'failed'
  status          String
  startedAt       DateTime?
  finishedAt      DateTime?
  /// Opaque resume token — for jobs: next page URL; for lineitems: next index.
  cursor          String?
  itemsProcessed  Int       @default(0)
  /// null until the first tick discovers the total
  itemsTotal      Int?
  errorCount      Int       @default(0)
  consecutiveErrors Int     @default(0)
  lastError       String?
  /// Optimistic lock — set at start of every tick, cleared at end.
  /// Prevents duplicate ticks (QStash at-least-once delivery).
  claimedAt       DateTime?
  /// true once the data this run produced has been promoted to "live".
  /// Last successful run with promoted=true is what the UI reads.
  promoted        Boolean   @default(false)
  createdAt       DateTime  @default(now())

  tenant          Tenant            @relation(fields: [tenantId], references: [id])
  schedule        BackfillSchedule? @relation(fields: [scheduleId], references: [id])

  @@index([tenantId, source, status])
  @@index([source, promoted, finishedAt])
}
```

### 4.3 Raw landing tables

One per source. Single JSONB column holds the full Rooflink response, keyed
by (rooflink_id, data_version). `data_version` = `BackfillRun.id`.

```prisma
model RawRooflinkJob {
  rooflinkId  String
  dataVersion Int
  payload     Json
  fetchedAt   DateTime @default(now())

  @@id([rooflinkId, dataVersion])
  @@index([dataVersion])
}

model RawRooflinkLineItems {
  estimateId  String
  dataVersion Int
  payload     Json
  fetchedAt   DateTime @default(now())

  @@id([estimateId, dataVersion])
  @@index([dataVersion])
}
```

### 4.4 Normalized + derived tables

These replace `generated.json` as the UI's read source. The tick worker writes
both raw (4.3) and normalized (4.4) rows in the same DB transaction so they
can't drift.

```prisma
model Job {
  id                 String   @id   // Rooflink job id
  dataVersion        Int
  /// raw fields needed by the UI — gt_price, payments, date_created, rep, region, etc.
  /// Shape mirrors what generated.json exposes today.
  /// (Listed individually for typed access; see DATA_MODEL.md for the full list.)
  // ... omitted for brevity ...

  /// derived fields — computed in shared/domain/* at end-of-tick
  heatScore          Int?
  heatBand           String?    // 'cool' | 'warm' | 'hot' | 'critical'
  agingBucket        String?    // 'within' | '1-30' | '31-60' | '60+'
  anomalyFlags       Json?      // { unbalanced_payments: true, ... }

  fetchedAt          DateTime   @default(now())

  @@index([dataVersion])
  @@index([dataVersion, heatBand])
  @@index([dataVersion, agingBucket])
}
```

Similar `EstimateLineItem` model with derived fields (`amountWithheld`, etc.).
Full field list to be enumerated in [DATA_MODEL.md](DATA_MODEL.md) update.

### 4.5 `FailureNotificationSetting` — the new "ops email" card

```prisma
model FailureNotificationSetting {
  id          Int      @id @default(autoincrement())
  tenantId    Int      @unique
  /// Email that receives notifications when a brief send or backfill run fails.
  /// Distinct from per-cadence brief recipients on purpose — ops, not users.
  opsEmail    String?
  updatedAt   DateTime @updatedAt

  tenant      Tenant   @relation(fields: [tenantId], references: [id])
}
```

---

## 5. Execution model — chunked QStash ticks

### 5.1 Why ticks (not one long function)

Vercel Hobby caps a function at **60 seconds**. A 2.5-hour backfill cannot run
in one invocation. Instead, the work is split into ~170 short "ticks" chained
through QStash. Each tick:

1. Claims the run (optimistic lock on `claimedAt`).
2. Fetches a small batch from Rooflink at 1 req/sec.
3. Writes raw + normalized rows in one transaction.
4. Advances the cursor.
5. Publishes the next tick to QStash with a small delay.
6. Releases the claim.

### 5.2 Batch sizing

Rooflink rate limit: 1 request/second (parallel = WAF block).
Tick budget on Hobby: 60s function timeout → ~50s usable after overhead.

| Source | Batch size | Ticks per run | Wall time |
|---|---|---|---|
| `rooflink_jobs` | 50 pages × 100 jobs = 5,000 jobs/tick? No — `/jobs/` is paginated, **one page = 1 request**, so 50 pages/tick. | ~21 | ~17 min |
| `rooflink_lineitems` | 50 estimates/tick (50 × 1s = 50s) | ~170 | ~2h 22min |

### 5.3 Locking (the `claimedAt` pattern)

QStash is at-least-once — occasionally delivers duplicate messages. Without a
lock, two ticks for the same run could race on the cursor.

Each tick starts with:

```sql
UPDATE BackfillRun
SET claimedAt = NOW()
WHERE id = ?
  AND status = 'running'
  AND (claimedAt IS NULL OR claimedAt < NOW() - INTERVAL '90 seconds')
RETURNING id;
```

If 1 row updated → tick owns the work. If 0 → another tick has the lock, exit
silently. 90-second TTL > 60s function cap, so a crashed tick releases the
lock automatically on the next attempt.

Same pattern as [dispatch-briefs:87](../apps/web/app/api/cron/dispatch-briefs/route.ts:87)
uses on `nextRunAt`.

### 5.4 Cron consolidation

`/api/cron/dispatch-briefs` → renamed to `/api/cron/dispatch-due`. Same 15-min
QStash schedule, but the route now:

1. Polls `Schedule` for due email sends (existing behavior).
2. Polls `BackfillSchedule` for due backfills.
3. For each due backfill: creates a new `BackfillRun` row, publishes the first tick.

The daily `/api/cron/generate-briefings` (7am Central) **stays as a separate
cron** — different cadence, different shape, no benefit to consolidating.

---

## 6. UI changes — `/dashboard/scheduler`

### 6.1 New "Data sync" section

Slots between "Reports" and "Highlights" in
[SchedulerView.tsx](../apps/web/app/dashboard/scheduler/SchedulerView.tsx).
Two cards, one per source. Each mirrors the `ReportRow` pattern (see
[SchedulerView.tsx:671](../apps/web/app/dashboard/scheduler/SchedulerView.tsx:671)).

Each card shows:

- Title + status pill (`Idle` / `Running n/total` / `Failed` / `Paused`)
- Last run summary (`2026-05-09 03:00 UTC · 8,492 rows · 2h 18min`)
- Cadence editor (cadence + day + time, identical to existing brief rows)
- **Three buttons:**
  - `Run now` — disabled while a run is in progress; replaced with `Cancel current run` instead
  - `Save changes` — same as brief rows
  - `Remove` — same as brief rows
- Pause/Resume switch (same UX as existing brief rows)

### 6.2 New "Failure notifications" card

Below "Data sync". One field, one save button.

```
Failure notifications
─────────────────────────────────────────────────
Email   [____________________________]   [Save]

Notify me when a scheduled brief or data sync fails.
```

Backs `FailureNotificationSetting`. Distinct from the per-cadence brief
recipients on purpose — ops, not users.

### 6.3 Progress display — polling, not WebSocket

Vercel Hobby cannot host persistent WebSocket connections. socket.io requires
a long-lived server process which serverless functions don't provide.

While a backfill run is active and the scheduler page is open, the client
polls `GET /api/backfills/active` every 5 seconds and updates the card:

- `Running · 4,231 / 8,492 · ETA 1h 12m`
- Toast notification on status transitions (`running → completed`, `running → failed`)
- Loading shimmer / spinner on the card body

5s polling × max 2.5h × one operator = ~1,800 requests per backfill.
Cheap on Vercel. Easy to upgrade to SSE in V2 if needed.

---

## 7. Failure handling — layered

Three layers, each with a distinct job:

### Layer 1 — In-tick transient retry

Inside a tick, retry HTTP 5xx and network timeouts up to **3 times with
exponential backoff** (1s, 2s, 4s). Do not retry 4xx — those are real errors
that don't fix themselves. Auth failures (401/403) abort the whole run
immediately, mirroring [backfill.py:89](../backfill.py:89).

### Layer 2 — Run-level halt

If a tick sees **2 consecutive non-transient errors** (mirrors
[backfill.py:23](../backfill.py:23) `MAX_CONSECUTIVE_FAILURES = 2`), it:

1. Marks the run `status = 'failed'`
2. Writes `lastError` with the error message
3. Stops publishing new ticks

### Layer 3 — Operator notification

When `status` transitions to `'failed'`, send **one email** (via Resend, using
[apps/web/lib/email.ts](../apps/web/lib/email.ts)) to the address configured in
`FailureNotificationSetting.opsEmail`. Subject: `"Vera: rooflink_lineitems
backfill failed at 4,231 / 8,492"`. Body: link to the scheduler page.

One email per terminal failure, not per tick.

---

## 8. Cancellation

Operator clicks "Cancel current run":

1. UI POSTs `/api/backfills/:source/runs/:id/cancel`.
2. Route sets `status = 'canceled'` and `finishedAt = NOW()`.
3. The next tick that wakes up reads `status != 'running'` and exits without
   doing work or publishing a successor.
4. **Hard delete:** within the same request, `DELETE FROM RawRooflinkLineItems
   WHERE dataVersion = ?` and the same on the normalized table. Synchronous —
   ~5k row deletes complete in well under a second.

`promoted` is never flipped, so the UI never saw the partial data anyway. The
hard-delete is for storage hygiene, not correctness.

---

## 9. Versioning, promotion, and retention

### 9.1 The version-promotion pattern

Each `BackfillRun.id` is the `dataVersion` for the rows it wrote. The UI reads:

```sql
WHERE dataVersion = (
  SELECT id FROM BackfillRun
   WHERE source = ?
     AND status = 'completed'
     AND promoted = true
   ORDER BY finishedAt DESC
   LIMIT 1
)
```

End-of-run: the last tick (the one that empties the cursor) atomically sets
`status = 'completed'`, `promoted = true`, and `previous_version.promoted =
false` in one transaction. Until that flip, the UI continues reading the
previous version.

This is the atomic swap — no schema-rename, no migration, just a flag flip.

### 9.2 Rollback

Flip `promoted` on an older `BackfillRun` row. Instant revert. Useful if a
backfill completes but the derived data looks wrong.

### 9.3 Retention

Keep the **last 3 successful versions** per source. A nightly cleanup (folded
into `/api/cron/dispatch-due`'s housekeeping pass):

```sql
DELETE FROM RawRooflinkLineItems
WHERE dataVersion IN (
  SELECT id FROM BackfillRun
   WHERE source = 'rooflink_lineitems'
     AND status = 'completed'
   ORDER BY finishedAt DESC
   OFFSET 3
);
-- Same for normalized tables.
```

~15MB × 3 = 45MB raw storage ceiling per source. Negligible on Neon.

---

## 10. Day-1 cutover runbook

The first run *against prod Neon* is the cutover moment. Done in two phases
so a backfill failure doesn't break the UI.

### Phase A — soak (no production impact)

1. Merge the backfill scheduler PR. API routes still read `generated.json`.
2. Create a Neon branch. Apply the new schema migration to the branch only.
3. Run "Run now" against the **branch** — both `rooflink_jobs` then
   `rooflink_lineitems`. ~3h total.
4. Verify data lands correctly. Spot-check 5–10 random estimates against the
   Rooflink UI.

### Phase B — production cutover

1. Promote the migration to the prod Neon DB.
2. Run "Run now" against prod — `rooflink_jobs` first (~17 min).
3. Verify the dataset count matches `wc -l data/jobs_dedup.jsonl`.
4. Run "Run now" for `rooflink_lineitems` (~2h 22min).
5. Verify UI works end-to-end pointing at Neon.
6. **Follow-up commit** (separate PR): delete `generated.json`, the
   build-time preprocess script, and the `apps/web/lib/data.ts` JSON loader.
   Swap the API routes to read from Prisma. Update Playwright fixtures.

### Phase C — schedule the recurring backfill

1. On the scheduler page, set the schedule for both sources.
   Recommended: weekly on Sunday at 02:00 in the tenant timezone (jobs)
   and 03:00 (lineitems) — gives jobs a 1h cushion before lineitems depends on it.
2. Verify the schedule shows the correct `nextRunAt` in the UI.

---

## 11. API surface

New routes:

| Route | Method | Purpose |
|---|---|---|
| `/api/backfills` | GET | List `BackfillSchedule` rows + active runs |
| `/api/backfills/:source/schedule` | PUT | Upsert schedule (mirrors `/api/schedules/[cadence]`) |
| `/api/backfills/:source/schedule` | DELETE | Remove schedule |
| `/api/backfills/:source/runs` | POST | Create + kick off a `BackfillRun` (Run-now). Refuses if one is already in flight. |
| `/api/backfills/:source/runs/:id/cancel` | POST | Cancel an active run + hard-delete its rows |
| `/api/backfills/active` | GET | Lightweight poll target — returns current `running` runs with `itemsProcessed/itemsTotal` |
| `/api/cron/backfill-tick` | POST | QStash-signed entry point for ticks |
| `/api/notifications` | GET / PUT | Read / write the `FailureNotificationSetting` row |

Renamed:

| Old | New | Why |
|---|---|---|
| `/api/cron/dispatch-briefs` | `/api/cron/dispatch-due` | Now dispatches both briefs and backfill kickoffs. Requires updating the QStash schedule URL once. |

---

## 12. Testing

Per [CLAUDE.md](../CLAUDE.md) hard rule #7 — every new route gets a Playwright
spec. New specs:

- `tests/e2e/backfill-schedule.spec.ts` — UI happy path: create schedule, edit,
  pause, remove, run-now, cancel.
- `tests/e2e/backfill-tick.spec.ts` — calls `/api/cron/backfill-tick` with a
  mocked Rooflink fixture; asserts cursor advances + promotion happens at end.
- Extend existing [tests/e2e/scheduler.spec.ts](../tests/e2e/scheduler.spec.ts)
  with assertions about the new "Data sync" section.

Mocking strategy:

- Rooflink calls are mocked in CI via a fixture in `tests/fixtures/rooflink/`.
- One smoke test runs against the real Rooflink API in local dev only, gated
  behind `RUN_LIVE_ROOFLINK=1`. Matches the `RUN_LIVE_AI=1` /
  `RUN_LIVE_EMAIL=1` pattern.

---

## 13. Open questions

Outside the scope of this design doc — flag for the tech-lead review pass.

1. **Vercel plan path:** if the per-tick overhead crowds 50s on Hobby, the
   cleanest fix is upgrading to Pro (300s per function). Do not redesign
   around batch-size yet — measure first.
2. **QStash signing key rotation:** `verifyCronAuth` already accepts both
   current and next signing keys ([cron-auth.ts:39](../apps/web/lib/cron-auth.ts:39)).
   No new work, but noting that the backfill-tick route inherits this.
3. **Data freshness in the UI:** the UI today shows
   `Data as of <generated.json mtime>`. After cutover, replace with
   `Data as of <BackfillRun.finishedAt>` of the currently-promoted version per
   source. Surface stale-data warnings if `finishedAt > 7 days ago`.
4. **CLAUDE.md drift:** rule #5 ("No DB writes") is already out of sync with
   reality. This PR is a good moment to update CLAUDE.md alongside.

---

## 14. V2 follow-ups (explicitly out of scope here)

- Incremental sync via `date_last_edited`.
- Per-tenant Rooflink credentials (when we onboard a second tenant).
- SSE / WebSocket for progress instead of polling.
- Slack notifications alongside email on failure.
- A "rollback to previous version" button in the UI.
- Backfill of other Rooflink endpoints (estimates list, customers, invoices).
