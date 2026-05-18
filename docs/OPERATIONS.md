# Operations runbook

Recipes for things you'll actually do. If [`INFRASTRUCTURE.md`](INFRASTRUCTURE.md)
is the map, this is the manual.

> Last updated: 2026-05-14

---

## Table of contents

### Daily ops
- [Trigger a Rooflink backfill (Run-now or scheduled)](#trigger-a-rooflink-backfill)
- [Configure recurring backfills](#configure-recurring-backfills)
- [Check whether a backfill completed and what data it produced](#check-a-backfill)
- [Send a daily AR brief right now](#send-a-brief-now)
- [Schedule a recurring brief](#schedule-a-recurring-brief)
- [Refresh the AI dashboard briefing](#refresh-the-dashboard-briefing)

### Deployment
- [Deploy to production](#deploy-to-production)
- [Roll back the DB read path to the JSON snapshot (emergency)](#roll-back-the-db-read-path)
- [Roll back a bad deploy](#roll-back-a-bad-deploy)

### Database
- [Connect to vera_prod (read-only investigation)](#connect-to-vera_prod)
- [Connect to vera_dev (local)](#connect-to-vera_dev)
- [Restore local DB from production (after a wipe)](#restore-local-db-from-production)

### Secrets
- [Rotate a secret](#rotate-a-secret)
- [Rotate the vera_app DB password](#rotate-the-vera_app-db-password)

### Troubleshooting
- [Diagnosing a stuck backfill](#diagnosing-a-stuck-backfill)
- [Why didn't my dashboard data update?](#why-didnt-my-dashboard-data-update)
- [Common Vercel deploy failures](#common-vercel-deploy-failures)

---

## Daily ops

### Trigger a Rooflink backfill

The fastest way to pull fresh data from Rooflink into the DB.

**Via the UI (recommended):**
1. Open `/dashboard/scheduler` on production.
2. Switch to the **Data sync** tab.
3. Click **Run now** on either source (`Rooflink jobs` or `Rooflink line items`).
4. A toast confirms the run started. The run page polls for progress.

**Mode selection** is automatic: if a previous completed run exists, the new
run uses `incremental` mode and only fetches records edited since
`BackfillSchedule.lastSyncedAt`. First-ever run uses `full` mode and pulls
everything. Force a full re-sync by adding `?mode=full` if hitting the API
directly.

**Via the API:**

```bash
curl -X POST 'https://vera-mvp.vercel.app/api/backfills/rooflink_jobs/runs' \
  -H "Cookie: __Secure-authjs.session-token=<your-session-token>"
```

**What happens next:** the route inserts a `BackfillRun` row, publishes the
first tick to QStash. The tick worker fetches one page from Rooflink,
writes raw JSONB to `RawRooflinkJob` (or `RawRooflinkLineItems`), publishes
the next tick. Last tick marks `promoted=true` and invalidates the dashboard
cache. After that, every dashboard request sees the new data.

**How long it takes:**
- Incremental, jobs: 1–5 min (depends on how many records changed).
- Incremental, line items: 5–30 min (one Rooflink API call per estimate).
- Full, jobs: ~17 min (103k records at 1 req/sec).
- Full, line items: ~2.5 hours (8,500 estimates at 1 req/sec).

### Configure recurring backfills

Same Scheduler page → **Data sync** tab → click the gear next to a source →
pick cadence + time. One row per source per tenant (natural key).

```
Cadence:    daily / weekly / monthly
Time:       any 15-min increment in the tenant's timezone
Timezone:   IANA (e.g. America/Chicago)
```

After saving, the cron dispatcher (`/api/cron/dispatch-briefs`, which also
handles backfills) picks up the row on its next sweep (within 15 min).

### Check a backfill

```sql
-- Most recent runs, any source
SELECT id, source, status, mode, promoted, "itemsProcessed", "itemsTotal",
       "startedAt", "finishedAt", "lastError"
FROM "BackfillRun"
ORDER BY id DESC
LIMIT 10;

-- What's currently the "live" snapshot
SELECT id, source, "itemsProcessed", "finishedAt"
FROM "BackfillRun"
WHERE promoted = true AND status = 'completed'
ORDER BY id;

-- How many distinct records are in the live snapshot
SELECT count(DISTINCT "rooflinkId") AS live_jobs
FROM "RawRooflinkJob"
WHERE "dataVersion" IN (
  SELECT id FROM "BackfillRun"
  WHERE promoted=true AND status='completed' AND source='rooflink_jobs'
);
```

A sync-complete email lands in the configured recipient inbox after every
successful non-empty run. The PDF attached lists up to 200 records the run
touched. See [`SYNC_EMAIL.md`](SYNC_EMAIL.md) for the full pipeline.

### Send a brief now

`/dashboard/scheduler` → **Briefings** tab → click **Send now** on the row
for the recipient you want. The route generates the PDF in-process, calls
Resend, and logs the send in `SendLog` and `AuditLog`.

Without `RESEND_API_KEY` set, the route returns 503 with a clear error.

### Schedule a recurring brief

Same page → **Briefings** tab → set cadence + time. The dispatcher fires
when `nextRunAt <= now`, claims the row by atomically advancing `nextRunAt`,
and triggers the send.

Up to ~15 min drift between the configured time and the actual fire because
the cron sweep runs every 15 min. For daily briefs at 8 AM, this is
invisible.

### Refresh the dashboard briefing

The AI briefing at the top of `/dashboard` regenerates automatically every
weekday at 7 AM Central via the `generate-briefings` GitHub Actions cron.

To regenerate on demand:
1. Open `/dashboard` while signed in.
2. Click **Fetch latest news**.
3. The route calls Anthropic, writes a new `Briefing` row, and the page
   re-renders.

---

## Deployment

### Deploy to production

```bash
cd /Users/aditya-levich/Build/israil_mvp   # never from a worktree
git checkout main
git pull origin main
vercel --prod --yes
```

Auto-deploy is broken (the Vercel team and GitHub repo are owned by
different accounts that can't see each other) — this manual deploy is
required after every merge to `main` until that's resolved.

Expected duration: ~90 seconds end-to-end.

### Rolling back the read path

There is no JSON fallback anymore — the dashboard reads directly from
Postgres. If reads ever start returning wrong data the rollback is a
deployment-level revert (`vercel rollback`, below) plus, if needed,
swapping the promoted snapshot at the DB level (see "Re-promote a
previous backfill snapshot" later in this doc).

### Roll back a bad deploy

```bash
vercel rollback   # interactive — picks the previous Ready deployment
```

This re-aliases `vera-mvp.vercel.app` to the prior deployment. **It does
not roll back env vars** — those are project-level. If the deploy that's
being rolled back depended on an env-var change, revert that too.

---

## Database

### Connect to vera_prod

Read-only investigation should always use a temporary `psql` session, not
saved tools. The connection string is in your `.env.local`.

```bash
# Pull connection string from Vercel env (or use what you have locally)
vercel env pull /tmp/prod.env --environment=production
source <(grep DATABASE_URL /tmp/prod.env)
rm /tmp/prod.env

psql "$DATABASE_URL"

# Always disconnect when done
\q
```

For sensitive queries (anything that mutates), open a separate terminal,
acknowledge what you're about to do out loud, run it, exit. Don't keep a
long-lived superuser session.

### Connect to vera_dev

```bash
psql -U aditya.uphade -d vera_dev   # localhost defaults
```

### Restore local DB from production

If your local DB has been wiped (e.g. by Playwright global-setup losing its
guard, or accidentally `prisma migrate reset`), restore from `vera_prod`:

```bash
VERA_APP_PASSWORD=$(cat /tmp/vera_app_password.txt)   # or wherever you stash it

for table in BackfillRun RawRooflinkJob RawRooflinkLineItems FailureNotificationSetting; do
  echo "Copying $table..."
  PGPASSWORD="$VERA_APP_PASSWORD" psql "host=34.56.121.151 port=5432 user=vera_app dbname=vera_prod sslmode=require" \
    -c "COPY \"$table\" TO STDOUT" | \
  psql -U aditya.uphade -d vera_dev -c "COPY \"$table\" FROM STDIN"
done
```

About 90 seconds total. The piped `COPY` works around the pg_dump 15 → PG 16
version mismatch; no temp files needed.

Verify after:

```sql
SELECT count(*) FROM "BackfillRun" WHERE promoted=true AND status='completed';
-- expect: 2 (jobs run #131 + lineitems run #135)
```

---

## Secrets

### Rotate a secret

| Secret | Where to rotate | How |
|---|---|---|
| `AUTH_SECRET` / `NEXTAUTH_SECRET` | Generate a new value | `openssl rand -hex 32` then update Vercel env + local `.env.local` |
| `ANTHROPIC_API_KEY` | Anthropic console → API Keys | Create new key, update Vercel env, delete old key |
| `RESEND_API_KEY` | Resend dashboard → API Keys | Create new key, update Vercel env, delete old key |
| `GOOGLE_CLIENT_SECRET` | GCP Console → APIs & Services → Credentials | Rotate, update Vercel env. Auth sessions still valid — JWT is signed by `AUTH_SECRET`, not by Google |
| `CRON_SECRET` | Generate a new value | `openssl rand -hex 32`. Update Vercel env AND `gh secret set CRON_SECRET` for the GitHub Actions cron |
| `QSTASH_*_SIGNING_KEY` | Upstash dashboard → QStash | Rotate, update Vercel env |
| `RL_KEY` (Rooflink) | Ask Israel | Update Vercel env |

After any rotation, redeploy: `vercel --prod --yes`.

### Rotate the vera_app DB password

```bash
NEW_PWD=$(openssl rand -base64 32 | tr -d '/+=\n')

# Update the role
PGPASSWORD='<postgres-admin-pwd>' psql "host=34.56.121.151 port=5432 user=postgres dbname=postgres sslmode=require" \
  -c "ALTER USER vera_app WITH PASSWORD '${NEW_PWD}';"

# Update Vercel
NEW_URL="postgresql://vera_app:${NEW_PWD}@34.56.121.151:5432/vera_prod?sslmode=require"
vercel env rm DATABASE_URL production -y
printf '%s\n' "$NEW_URL" | vercel env add DATABASE_URL production
vercel env rm DATABASE_URL_UNPOOLED production -y
printf '%s\n' "$NEW_URL" | vercel env add DATABASE_URL_UNPOOLED production

# Redeploy to pick it up
vercel --prod --yes

# Verify
unset NEW_PWD NEW_URL
```

Total downtime: zero — the new deployment goes live with the new
credentials before the old one is torn down.

---

## Troubleshooting

### Diagnosing a stuck backfill

A `BackfillRun` is "stuck" if `status=running` and `claimedAt` is more than
a few minutes old. The tick worker should be advancing or releasing the
claim every tick.

```sql
SELECT id, source, status, "itemsProcessed", "itemsTotal",
       "consecutiveErrors", "lastError",
       NOW() - "claimedAt" AS time_since_last_claim,
       NOW() - "startedAt" AS time_since_start
FROM "BackfillRun"
WHERE status = 'running'
ORDER BY id DESC;
```

**Common causes:**

| Symptom | Cause | Fix |
|---|---|---|
| `time_since_last_claim > 5 min`, `consecutiveErrors = 0` | QStash didn't redeliver the tick | Manually publish a tick: `POST /api/backfills/[source]/runs/[id]` is one option, or `vercel logs` to see what happened |
| `consecutiveErrors > 0`, `lastError` is a 5xx from Rooflink | Rooflink WAF throttling | Wait and let exponential backoff catch up. After 5 consecutive errors the run auto-fails. |
| `consecutiveErrors > 0`, `lastError` mentions auth | `RL_KEY` is stale | Rotate the Rooflink key |
| Stuck >30 min with no progress | Truly wedged | Cancel via `POST /api/backfills/[source]/runs/[id]/cancel`, start a fresh Run-now |

### Why didn't my dashboard data update?

Quick checklist:

1. **Is the latest run promoted?**
   ```sql
   SELECT id, source, status, promoted FROM "BackfillRun" ORDER BY id DESC LIMIT 5;
   ```
   If `promoted=false`, the merge view ignores the run. Only completes that
   reach `promoted=true` become live.

2. **Did `lastSyncedAt` advance on the schedule?**
   ```sql
   SELECT source, "lastSyncedAt", "lastFullSyncAt" FROM "BackfillSchedule";
   ```
   If not, the next incremental will re-fetch from the old watermark — fine,
   just slower than expected.

3. **Has your function instance cached the previous snapshot?** The in-memory
   cache is keyed by promoted-run-ids, so a new promote busts it. But cold
   instances need a request before they warm up. Hit the dashboard once;
   subsequent requests should be fast.

4. **Is the right `BackfillRun` promoted?**
   ```bash
   psql "$DATABASE_URL" -c "SELECT id, source, mode, \"itemsProcessed\", \"startedAt\" FROM \"BackfillRun\" WHERE promoted=true ORDER BY source, id DESC;"
   ```
   If a recent full sync demoted a healthy snapshot in favor of a tiny
   one, that's the 2026-05-18 mock-data incident pattern (see RELEASE.md).

### Common Vercel deploy failures

Pre-existing reference table in [`INFRASTRUCTURE.md`](INFRASTRUCTURE.md)
under "Common build issues". The biggest one for this project: never deploy
from a worktree.

---

## When to ask before doing anything

Default to asking if you're about to:

- `DELETE` or `UPDATE` more than a single row on **any** database.
- Drop a column, table, or index.
- Run `prisma migrate reset` against a DB that has any rows.
- Rotate a secret while a release is in flight.
- Push to `main` without testing locally.
- Set `PLAYWRIGHT_ALLOW_PROD_DATA_WIPE=1` (you almost certainly don't want this).

The cost of asking is 30 seconds. The cost of an unintended wipe is hours
of re-fetching from Rooflink.
