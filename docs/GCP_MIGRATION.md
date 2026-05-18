# GCP database migration runbook

> **Historical record (executed 2026-05-14).** Vera is on GCP Cloud SQL
> in production. References to the `USE_DB_DATA_SOURCE` flag in this
> runbook describe how the cutover was gated at the time; that flag
> was removed on 2026-05-18 (see
> [`JSON_REMOVAL_PLAN.md`](JSON_REMOVAL_PLAN.md)). The DB read path is
> now the only path.

Moving Vera's production database from Neon to a new GCP Cloud SQL Postgres
instance, without re-running the multi-hour Rooflink backfill against
production.

> Status: **Phase 2 complete (data is in GCP). Phase 3 + Phase 4 pending.**
> Last updated: 2026-05-14.

---

## TL;DR

- **Neon is being abandoned**, not migrated. It hit its data-transfer quota
  and the data on it isn't load-bearing for the dashboard read path (prod
  reads `generated.json` today).
- **Local Postgres (`vera_dev`) is the source of truth** for the heavy
  Rooflink data — 120,300 raw jobs + 8,942 line-items, gathered by manual
  "Run now" backfills on May 13.
- **GCP destination**: a new database `vera_prod` on the shared Cloud SQL
  instance at `34.56.121.151`. Same server hosts `bap_dev`,
  `priority_crm_test_db`, etc. — those are isolated and untouched.
- **App role**: `vera_app` (least-privilege, owns `vera_prod` only).
- **Cutover is gated by `USE_DB_DATA_SOURCE=1`** on Vercel. Until that flag
  flips, prod keeps reading the bundled JSON snapshot — DB swap is
  invisible to users.

---

## Architecture before / after

### Before

```
┌─────────────┐         ┌────────────────────┐
│ Vercel prod │ ──────► │ Neon Postgres      │  (quota-exhausted, stale,
│ (web app)   │  auth   │ neondb_owner@neon  │   not on dashboard read path)
└─────────────┘ writes  └────────────────────┘
       │
       │ dashboard read path
       ▼
┌─────────────────────┐
│ generated.json      │  (bundled at build time, "today" pinned to May 5)
└─────────────────────┘
```

### After Phase 3 + flag flip

```
┌─────────────┐         ┌────────────────────────────────────┐
│ Vercel prod │ ──────► │ GCP Cloud SQL Postgres 16          │
│ (web app)   │ all DB  │ host: 34.56.121.151                │
│             │ reads + │ db:   vera_prod                    │
│             │ writes  │ user: vera_app                     │
└─────────────┘         │ shared instance — other DBs        │
                        │ (bap_dev, etc.) are isolated       │
                        └────────────────────────────────────┘
```

---

## What's been done (Phase 1 + Phase 2)

### Phase 1 — Pre-flight (read-only)

1. Verified GCP connectivity over SSL.
2. Listed the 9 existing databases on the shared instance — confirmed no
   name collision and that other products' data is in separate databases.
3. Confirmed `postgres` role has `CREATEDB` + `CREATEROLE` (sufficient for
   what we need; not a true superuser, which is expected on Cloud SQL).
4. Created the empty `vera_prod` database (UTF-8 encoding).
5. Created a scoped `vera_app` role and made it owner of `vera_prod` and
   the `public` schema. Vercel will connect as this role — leak surface is
   contained to one database.
6. Applied all 5 Prisma migrations to `vera_prod`. Schema now matches
   `apps/web/prisma/schema.prisma` exactly — 11 tables including
   `AuditLog` (which local was missing until today).

### Phase 2 — Data migration (local → GCP)

7. Brought local DB up to schema parity by applying the pending
   `20260511103539_audit_log` migration. Local is now the same shape as
   what we just provisioned on GCP.
8. Dumped 5 tables from local using `pg_dump --data-only --no-owner
   --no-acl`, with primary keys preserved so the soft FK
   `RawRooflinkJob.dataVersion = BackfillRun.id` survives the move.
9. Stripped `DISABLE/ENABLE TRIGGER ALL` lines (those require superuser,
   not available on Cloud SQL).
10. Restored cleaned dump into `vera_prod` — 90 seconds, no errors.
11. Verified row counts match local 1:1 and that the merge-view query
    returns the expected 103,440 jobs + 8,434 line-items.

The data on GCP is now byte-equivalent to what local has. **No Rooflink
API calls were made** during the migration.

---

## What's pending (Phase 3 + Phase 4)

### Phase 3 — Ship the code, then wire the DB

This phase is split into three independently-reversible toggles. Stop
between each and verify.

#### 3a. Ship the branch to prod (no behavior change)

The current `feat/db-data-source-cutover` branch contains:

- The `USE_DB_DATA_SOURCE` flag handling and `merge-view.ts` DB read path
- `loading.tsx` skeletons for every server-component route (8c4479f)
- The "check cache before heavy DB fetch" perf fix (12c2685)

All of this is dormant when `USE_DB_DATA_SOURCE=0`. Ship it first:

```bash
# From the canonical repo (NOT a worktree):
git checkout main
git merge feat/db-data-source-cutover --no-ff
git push origin main
vercel --prod --yes              # auto-deploy is broken — see CLAUDE.md
```

Verify production still loads. Dashboards should look identical (still
JSON read path) but now show skeleton loaders during page transitions.

#### 3b. Point Vercel at GCP (DB connection swap only)

On Vercel project settings → Environment Variables, **for the Production
environment**:

- `DATABASE_URL` → `postgresql://vera_app:<password>@34.56.121.151:5432/vera_prod?sslmode=require`
- `DATABASE_URL_UNPOOLED` → same value (Cloud SQL is direct, no pooler proxy)
- Keep `USE_DB_DATA_SOURCE` **unset or `0`**

The password lives at `/tmp/vera_app_password.txt` on the migration
machine. **Copy it into Vercel manually, then delete the local file.** Do
not paste it into chat, commits, or docs.

Redeploy. After deploy:

- Dashboards still read `generated.json` (no user-visible change)
- Auth, audit-log writes, briefing writes now go to GCP
- Verify by signing in once and checking `AuditLog` on `vera_prod` has a
  new row

**Rollback (if anything breaks):** revert `DATABASE_URL` to the old Neon
value (still in Neon, just over-quota; the app may not fully function but
won't crash on startup).

#### 3c. Flip the feature flag (the actual cutover)

On Vercel: `USE_DB_DATA_SOURCE=1` in Production env. Redeploy.

This activates the DB read path. Dashboards now compute heat scores, aging
buckets, and anomalies at request time against the DB rows instead of
parsing `generated.json`.

Verify on prod:

- `/dashboard/aging` shows ~130 AR jobs (the working-set filter on top of
  the full 103,440-row population, per memory notes from May 13)
- `/dashboard/write-offs` shows 373 records totaling ~$2.26M
- `/dashboard/follow-ups` and `/dashboard/reps-outstanding` render without
  errors

**Rollback (fast):** set `USE_DB_DATA_SOURCE=0`, redeploy. Instant revert
to JSON path. The DB stays connected for auth/audit; only the read path
flips.

### Phase 4 — Keep the data fresh

Right now `BackfillSchedule` is empty everywhere — no recurring backfill
is configured. The transplanted data is from May 13 and will stay frozen
unless we set up a schedule.

After Phase 3 verifies:

1. Open `/dashboard/scheduler` on prod.
2. Create one daily `BackfillSchedule` for `rooflink_jobs` (e.g. 02:00
   Central) and one for `rooflink_lineitems` (e.g. 04:00 Central).
3. Both schedules will run in `incremental` mode automatically — the
   tick worker reads `BackfillRun.lastSyncedAt` (populated by the
   transplanted runs) and only re-fetches records edited since then.
4. After 24h, verify `BackfillRun` shows two new `completed, promoted`
   incremental runs and dashboard numbers update.

---

## Connection cheatsheet

| Thing | Value |
|---|---|
| Server host | `34.56.121.151` |
| Server port | `5432` |
| Server version | PostgreSQL 16.13 (Cloud SQL) |
| SSL | required (`sslmode=require`) |
| App database | `vera_prod` |
| App role (for Vercel) | `vera_app` |
| App role password | stored at `/tmp/vera_app_password.txt` on the migration machine — copy to Vercel, then delete the file |
| Admin role (for emergencies) | `postgres` — password is in Israel's original credentials |
| Other databases on this server (do not touch) | `bap_dev`, `priority_crm_test_db`, `authentication_service_db`, `quickbooks_data`, `airflow_dev` |

### Connection string template

```
postgresql://vera_app:<URL-encoded-password>@34.56.121.151:5432/vera_prod?sslmode=require
```

If the password contains `/`, `+`, `=`, `@`, or `:`, URL-encode them. The
generated password used `tr -d '/+='` so it's already URL-safe.

---

## Verification queries

Useful one-liners for confirming state during/after cutover. Run via
`psql` with the connection string above.

### Row counts match local
```sql
SELECT 'Tenant' AS t, COUNT(*) FROM "Tenant"
UNION ALL SELECT 'BackfillRun', COUNT(*) FROM "BackfillRun"
UNION ALL SELECT 'RawRooflinkJob', COUNT(*) FROM "RawRooflinkJob"
UNION ALL SELECT 'RawRooflinkLineItems', COUNT(*) FROM "RawRooflinkLineItems";
-- Expect: 1, 17, 120300, 8942
```

### Promoted snapshot is intact
```sql
SELECT id, source, status, "itemsProcessed"
FROM "BackfillRun"
WHERE promoted = true AND status = 'completed'
ORDER BY id;
-- Expect: #131 (rooflink_jobs, 103440), #135 (rooflink_lineitems, 8436)
```

### Merge-view returns expected live counts
```sql
SELECT COUNT(DISTINCT "rooflinkId") AS live_jobs
FROM "RawRooflinkJob"
WHERE "dataVersion" IN (
  SELECT id FROM "BackfillRun"
  WHERE promoted = true AND status = 'completed' AND source = 'rooflink_jobs'
);
-- Expect: 103,440

SELECT COUNT(DISTINCT "estimateId") AS live_lineitems
FROM "RawRooflinkLineItems"
WHERE "dataVersion" IN (
  SELECT id FROM "BackfillRun"
  WHERE promoted = true AND status = 'completed' AND source = 'rooflink_lineitems'
);
-- Expect: 8,434
```

### Sequences won't collide on next insert
```sql
SELECT 'Tenant_id_seq' AS seq, last_value FROM "Tenant_id_seq"
UNION ALL SELECT 'BackfillRun_id_seq', last_value FROM "BackfillRun_id_seq";
-- last_value must be >= the corresponding MAX(id) in the table
```

---

## Rollback paths by phase

| If this fails | Rollback action |
|---|---|
| Phase 3a — the code deploy itself crashes | `vercel rollback` to previous deployment |
| Phase 3b — DB connection swap breaks auth or audit writes | Revert `DATABASE_URL` to old Neon value in Vercel env |
| Phase 3c — feature flag flip shows wrong dashboard numbers | Set `USE_DB_DATA_SOURCE=0`, redeploy (fastest, ~30s) |
| Schema-level corruption on GCP (worst case) | `DROP DATABASE vera_prod; CREATE DATABASE vera_prod;` and re-run Phase 2 from this doc |

The first three rollbacks are minutes. The fourth is ~10 minutes total
(re-run the dump + restore). Local `vera_dev` is the safety net — we
never destructively touch it during this migration.

---

## Where the data went on GCP (proof of work)

Phase 2 produced exactly the data we expected:

```
=== Row counts on vera_prod ===
Tenant                     |      1
BackfillRun                |     17
FailureNotificationSetting |      1
RawRooflinkJob             | 120300
RawRooflinkLineItems       |   8942

=== Promoted runs ===
 131 | rooflink_jobs      | completed | full | promoted=t | 103440 items
 135 | rooflink_lineitems | completed | full | promoted=t |   8436 items

=== Merge-view smoke tests ===
live_jobs:      103440
live_lineitems:   8434
```

Numbers match `vera_dev` 1:1.
