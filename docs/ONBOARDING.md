# Onboarding

Goal: a working local environment in **20 minutes**. Sign in, see the
dashboard with live data, run a Playwright spec.

> Last updated: 2026-05-14

---

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| Node.js | 22.x LTS | Next.js 16 + Prisma 6 |
| pnpm | 10.x | monorepo package manager (pinned in `package.json`) |
| Postgres (server + client) | 15+ | local dev DB, `psql` for poking around |
| Git | latest | clone the repo |
| `gh` CLI | latest (optional) | GitHub Actions ops, repo secrets |
| Vercel CLI | latest (optional) | deploy, pull env vars |

```bash
node -v   # should be v22.x
pnpm -v   # should be ≥ 10
psql --version
```

If you're missing pnpm: `npm i -g pnpm@10`.

On macOS, install Postgres with Homebrew: `brew install postgresql@15 && brew services start postgresql@15`.

---

## 1. Clone + install

```bash
git clone git@github.com:adityauphade-mac/vera-mvp.git
cd vera-mvp
pnpm install
```

The `install` step prints a warning about ignored build scripts (Prisma).
Approve on first run:

```bash
pnpm approve-builds
# pick @prisma/client, @prisma/engines, prisma → space, enter
```

---

## 2. Set up your local Postgres

```bash
createdb vera_dev
psql -d vera_dev -c "SELECT version();"
```

You should see PostgreSQL 15.x or newer. Note your local Postgres user
name (`whoami` on macOS Homebrew installs uses your shell user).

---

## 3. Configure environment variables

Vera needs ~12 environment variables to run locally. Copy them into
`apps/web/.env.local` (gitignored — never committed):

```bash
cp apps/web/.env.example apps/web/.env.local
```

Then fill in the values. Easiest paths:

**Option A — pull from Vercel** (if you have access to the project):

```bash
vercel link    # link this folder to the project
vercel env pull apps/web/.env.local
```

This downloads everything Vercel knows. You'll still need to override
`DATABASE_URL` to point at your local Postgres (see below) — otherwise
you'd be running local dev against the production GCP DB, which we don't
want.

**Option B — ask a teammate** for the values and paste them in manually.

| Variable | Where it comes from |
|---|---|
| `DATABASE_URL` | **Local**: `postgresql://<your-user>@localhost:5432/vera_dev` |
| `DATABASE_URL_UNPOOLED` | Same value as `DATABASE_URL` |
| `AUTH_SECRET` + `NEXTAUTH_SECRET` | Generate fresh: `openssl rand -hex 32`. Use the same value for both. |
| `NEXTAUTH_URL` | `http://localhost:3000` |
| `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` | GCP project → Credentials. See `../GCP_OAUTH_SETUP.md`. |
| `ANTHROPIC_API_KEY` | Anthropic console |
| `NEWSAPI_KEY` | newsapi.org account (free tier) |
| `RESEND_API_KEY` + `EMAIL_FROM` | Resend account (verified sender `makanalytics.org`) |
| `CRON_SECRET` | Generate fresh: `openssl rand -hex 32` |
| `QSTASH_CURRENT_SIGNING_KEY` + `QSTASH_NEXT_SIGNING_KEY` | Upstash QStash dashboard |
| `RL_KEY` | Rooflink API token — ask Israel |

**`.env.development.local` for splitting DB config.** Next.js loads
`.env.development.local` BEFORE `.env.local` during `pnpm dev`, so you
can keep a dev-only `DATABASE_URL` separate from your main env file
without losing your other secrets:

```bash
# apps/web/.env.development.local
DATABASE_URL=postgresql://<your-user>@localhost:5432/vera_dev
```

This file is gitignored.

---

## 4. Apply the DB schema

```bash
DATABASE_URL=postgresql://<your-user>@localhost:5432/vera_dev \
  pnpm --filter @vera/web prisma migrate deploy
```

You should see 5 migrations applied. Verify:

```bash
psql -d vera_dev -c "\dt"
# expect 11 application tables + _prisma_migrations
```

---

## 5. (Optional) Seed real data

Without seeded data, the dashboard renders correctly but with zero rows.
For testing the full UX with the production data shape:

```bash
# Pull connection string for GCP vera_prod from a teammate or Vercel
# DO NOT save it to disk — paste it inline
read -s GCP_URL    # paste the production DATABASE_URL, press enter

for table in BackfillRun RawRooflinkJob RawRooflinkLineItems FailureNotificationSetting; do
  echo "Copying $table..."
  psql "$GCP_URL" -c "COPY \"$table\" TO STDOUT" | \
  psql -d vera_dev -c "COPY \"$table\" FROM STDIN"
done

unset GCP_URL
```

About 90 seconds total. After this, your local DB has 120k Rooflink jobs
and 8.9k line items, ~130 of which are AR-eligible. The dashboard at
`/dashboard/aging` should show those 130 jobs.

The Playwright safety guard will now refuse to wipe this DB — see
[`TESTING.md`](TESTING.md).

---

## 6. Run the dev server

```bash
pnpm dev
```

Visit <http://localhost:3000>.

---

## 7. Sign in via Google

Click **Sign in with Google** at `/login`. For local development the
OAuth client needs `http://localhost:3000/api/auth/callback/google`
listed as an authorized redirect URI in GCP. If it isn't, sign-in fails
with `redirect_uri_mismatch`.

To add the redirect URI:
1. <https://console.cloud.google.com/apis/credentials>
2. Click the OAuth 2.0 Client ID Vera uses
3. Under **Authorized redirect URIs**, add `http://localhost:3000/api/auth/callback/google`
4. Save (may take ~30 s to propagate)

After sign-in, you land on `/dashboard`.

---

## 8. Smoke-test that everything works

In your terminal:

```bash
# Typecheck — should be clean
pnpm --filter @vera/web exec tsc --noEmit

# Lint — should be 0 errors
pnpm --filter @vera/web lint
```

In the browser:
- `/dashboard/aging` → ~130 rows (if you seeded), or empty table (if not)
- Click "Fetch latest news" on the dashboard → AI briefing renders
- `/dashboard/scheduler` → Data sync tab → click Run-now (mock-mode unless `RL_KEY` is set)

---

## 9. Where to look next

| If you want to… | Read |
|---|---|
| Understand what's deployed and where | [`INFRASTRUCTURE.md`](INFRASTRUCTURE.md) |
| Run an op (deploy, rollback, rotate a secret, restore local from prod) | [`OPERATIONS.md`](OPERATIONS.md) |
| Understand the schema + heat-score / aging math | [`DATA_MODEL.md`](DATA_MODEL.md) |
| Connect to / admin the production DB | [`GCP_DB_ADMIN.md`](GCP_DB_ADMIN.md) |
| Demo the app to someone | [`DEMO.md`](DEMO.md) |
| Add or run tests | [`TESTING.md`](TESTING.md) |
| Understand the post-sync PDF email | [`SYNC_EMAIL.md`](SYNC_EMAIL.md) |
| Find product-decision rationale | `SPEC.md`, `DISCUSSION.md` (repo root) |
| Coding rules ("the constitution") | `CLAUDE.md` (repo root) |
| What's shipped / on deck / deferred | [`BACKLOG.md`](BACKLOG.md) + [`RELEASE.md`](RELEASE.md) |

---

## Common first-run gotchas

| Symptom | Fix |
|---|---|
| `Module '@prisma/client' has no exported member 'PrismaClient'` | Run `pnpm --filter @vera/web exec prisma generate`. The `build` script does this automatically; dev mode doesn't always. |
| Sign-in redirects to a Google error page | Add the local redirect URI in GCP (step 7). |
| Dashboard 200s but shows zero rows | You haven't seeded the DB yet, or no `BackfillRun` is `promoted=true`. Run the backfill (`/dashboard/scheduler` → Run now) or load a SQL snapshot. |
| `/api/jobs/aging` returns 500 with timeouts | DB connection issue. Verify `DATABASE_URL` resolves and `psql "$DATABASE_URL"` works. |
| Playwright suite fails on global-setup with "refusing to wipe" | The suite is allowed to wipe `vera_test` only — see `scripts/setup-vera-test.sh` and the `tests/e2e/_helpers/global-setup.ts` guard. Run `pnpm test:e2e` (the wrapper sets `DATABASE_URL=postgresql://<user>@localhost/vera_test` for you). |
| Build fails with `Edge Function size 1.02 MB > 1 MB` | Something pulled Prisma into middleware. Verify `apps/web/middleware.ts` only imports from `@/lib/auth.config`, never `@/lib/auth`. |
| Worktrees keep failing | Worktrees need their own `.env.local` etc. — use `scripts/setup-worktree.sh <path>` to bootstrap one correctly. |
