# Vera — Onboarding

Goal: a working local environment in **15 minutes**. Sign in, see the
dashboard, fire a test brief.

> Last updated: May 8, 2026.

---

## Prerequisites

| | Version | Why |
|---|---|---|
| Node.js | 22.x (LTS) | Next.js 16 + Prisma 6 |
| pnpm | 10.x | monorepo package manager (pinned in `package.json`) |
| Postgres client | `psql` (any version) | for poking at the DB |
| Git, gh CLI | latest | clones + GitHub Actions ops |

```bash
node -v   # should be v22.x
pnpm -v   # should be ≥ 10
psql --version
```

If you're missing pnpm: `npm i -g pnpm@10`.

---

## 1. Clone + install

```bash
git clone git@github.com:adityauphade-mac/vera-mvp.git
cd vera-mvp
pnpm install
```

The `install` step prints a warning about ignored build scripts (Prisma).
Approve them on first run:

```bash
pnpm approve-builds
# pick @prisma/client, @prisma/engines, prisma → press space, then enter
```

---

## 2. Get the secrets

Vera needs **8 environment variables** to run locally. Copy them into
`apps/web/.env.local` (gitignored — never committed).

```bash
cp apps/web/.env.example apps/web/.env.local
# then edit apps/web/.env.local
```

Ask whoever set up your account (or pull from 1Password / Vercel) for the
real values:

| Variable | Where to find it |
|---|---|
| `DATABASE_URL` | Vercel project env (`vera-mvp` → Storage → Neon) |
| `AUTH_SECRET` + `NEXTAUTH_SECRET` | Vercel env (or generate fresh: `openssl rand -hex 32`) |
| `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` | GCP project `vera-ar` → APIs & Services → Credentials |
| `OPENAI_API_KEY` | OpenAI account |
| `NEWSAPI_KEY` | newsapi.org account (free tier) |
| `RESEND_API_KEY` + `EMAIL_FROM` | Resend account (sender domain `makanalytics.org`) |
| `CRON_SECRET` | Vercel env (or `openssl rand -hex 32` and update both Vercel + GitHub repo secrets) |

Fastest path: `vercel link` this folder to the project, then
`vercel env pull apps/web/.env.local` to grab everything Vercel knows.

---

## 3. Set up your local DB

The Neon database is shared across dev and prod (single-tenant MVP). When
your `DATABASE_URL` is pointed at it, you don't need to run migrations
locally — they're already applied. To seed the tenant row if needed:

```bash
pnpm --filter @vera/web db:seed
```

If you'd rather use a **separate local Postgres**, run migrations:

```bash
DATABASE_URL=postgres://… pnpm --filter @vera/web db:migrate:dev
DATABASE_URL=postgres://… pnpm --filter @vera/web db:seed
```

---

## 4. Build + run

Two ways to run:

```bash
# (a) dev mode — hot reload, fast
pnpm --filter @vera/web dev

# (b) prod-mode locally — closer to what's deployed
pnpm --filter @vera/web build
pnpm --filter @vera/web start
```

Visit http://localhost:3000.

---

## 5. Sign in

Click **Sign in with Google** at `/login`. **The Google account must be
allowed by the OAuth client** — for local development the OAuth client
needs `http://localhost:3000/api/auth/callback/google` listed as an
authorized redirect URI in GCP. If it isn't, the sign-in fails with
`redirect_uri_mismatch`.

Add your dev redirect URI in GCP:
1. Visit https://console.cloud.google.com/apis/credentials (project `vera-ar`)
2. Click the OAuth 2.0 Client ID Vera uses
3. Under **Authorized redirect URIs** add `http://localhost:3000/api/auth/callback/google`
4. Save

After sign-in, you land on `/dashboard`.

---

## 6. Smoke-test that everything works

In your terminal:

```bash
# typecheck — should be clean
pnpm --filter @vera/web typecheck

# lint — should be 0 errors, 0 warnings
pnpm --filter @vera/web lint

# Playwright suite — should be 95+ passing
PLAYWRIGHT_BASE_URL=http://localhost:3000 pnpm exec playwright test
```

In the browser:
- Dashboard loads → ✓
- Click "Fetch latest news" on the briefing card → AI briefing renders → ✓
- Sidebar → Scheduler → Click "Send now" with your email → check inbox → ✓

---

## 7. Where to look next

| If you want to… | Read |
|---|---|
| Understand what's deployed and how it talks | [`INFRASTRUCTURE.md`](./INFRASTRUCTURE.md) |
| Run an op (deploy, rollback, schedule a brief, manually trigger cron, rotate a secret) | [`OPERATIONS.md`](./OPERATIONS.md) |
| Demo the app to someone | [`DEMO.md`](./DEMO.md) |
| Add tests | [`TESTING.md`](./TESTING.md) |
| Understand the heat-score / aging math | [`DATA_MODEL.md`](./DATA_MODEL.md) |
| Find product-decision rationale | `SPEC.md` and `DISCUSSION.md` (in repo root) |
| Understand the coding rules | `CLAUDE.md` (in repo root) |

---

## Common first-run gotchas

| Symptom | Fix |
|---|---|
| `Module '@prisma/client' has no exported member 'PrismaClient'` | Run `pnpm --filter @vera/web exec prisma generate`. Build script does this automatically; dev mode doesn't. |
| Sign-in redirects to a Google error page | Add the local redirect URI in GCP (see step 5). |
| Dashboard pages blank / 500 | Check `DATABASE_URL` actually resolves and the Neon DB is reachable. Common: VPN blocking outbound 5432. |
| Build fails with `Edge Function size 1.02 MB > 1 MB` | Something pulled Prisma into middleware. Verify `apps/web/middleware.ts` only imports from `@/lib/auth.config`, never `@/lib/auth`. |
| Playwright says `0 tests found` | Specs prefixed with `_audit-`, `_debug-`, `prod-`, or `chat-live` are intentionally `testIgnore`d. Run them by passing `--config` overrides or by renaming. |
