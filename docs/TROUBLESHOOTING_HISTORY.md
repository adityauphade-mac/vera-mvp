# Vera — Troubleshooting history

Postmortems for the gotchas we've actually hit. Each entry documents the
**diagnosis**, not just the fix — so when the same shape of problem
shows up again, the next person can resolve it in minutes instead of
hours.

> Last updated: May 8, 2026.

---

## 1. Auth.js middleware bundle exceeded Edge Function 1 MB limit

**Date:** 2026-05-08 (during initial prod deploy of multi-tenant auth)

**Symptom:**
```
Error: The Edge Function "_middleware" size is 1.02 MB and your plan
size limit is 1 MB.
```
`vercel --prod` failed at the deploy step. Build succeeded.

**Diagnosis:** `apps/web/middleware.ts` was importing `auth` from
`@/lib/auth.ts`. That file imported `db` from `@/lib/db.ts`, which in
turn imports the full Prisma client. Result: the entire Prisma runtime
got bundled into the Edge runtime. Prisma alone is hundreds of KB.

**Fix:** Standard Auth.js v5 split-config pattern.

- `lib/auth.config.ts` — edge-safe. Provider list, pages config, JWT
  strategy. No DB. Tiny bundle.
- `lib/auth.ts` — full config. Spreads `authConfig` and adds the
  DB-touching `signIn` / `jwt` / `session` callbacks. Used by API routes
  and server components, NEVER by middleware.
- `middleware.ts` — uses `NextAuth(authConfig).auth()` directly via the
  edge-safe config.

After the split, middleware bundle dropped well under 1 MB.

**Detection going forward:** any future change that causes
`middleware.ts` to import (transitively) from `@/lib/db` will hit this
again. If you change `middleware.ts`, re-run `pnpm --filter @vera/web
build` and watch the "ƒ Proxy (Middleware)" line for size warnings.

**Reference commit:** `1f0bc52 fix(auth): split config so middleware bundle stays under 1 MB Edge limit`

---

## 2. Cron dispatcher hit 401 from `/api/brief/send` on first prod run

**Date:** 2026-05-08

**Symptom:** First successful run of `cron-dispatch-briefs.yml` returned
this body:
```json
{"dispatched": 0, "failed": 2,
 "results": [
   {"scheduleId": 25, "status": "failed", "error": "HTTP 401"},
   {"scheduleId": 26, "status": "failed", "error": "HTTP 401"}
 ]}
```
Two due schedules; both 401. Manual `Send now` from the UI worked fine.

**Diagnosis:** The dispatcher was calling `/api/brief/send` via HTTP:
```ts
const baseUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : 'http://localhost:3000';
await fetch(`${baseUrl}/api/brief/send`, { ... });
```

`process.env.VERCEL_URL` resolves to the **hashed per-deploy URL**
(e.g. `vera-8znwayap6-aditya-uphades-projects.vercel.app`), not the
canonical `vera-mvp.vercel.app`. Hashed deployment URLs are protected
by **Vercel Deployment Protection** by default — they require a Vercel
SSO session. The cron's `curl` had no such session; Vercel returned 401
before the request ever reached the route handler.

**Fix:** Refactor `/api/brief/send/route.ts` to expose a `sendBrief()`
function. The dispatcher imports and calls it **in-process** — no HTTP
hop, no auth, no protection layer. The HTTP POST handler still exists
(used by the "Send now" button), but it's a thin wrapper around
`sendBrief()`.

**Detection going forward:** if any server-side code does `fetch` to
its own API on Vercel using `VERCEL_URL`, it will hit Deployment
Protection. Either (a) call the underlying logic in-process like we do
now, (b) use `process.env.VERCEL_PROJECT_PRODUCTION_URL` (always the
canonical alias), or (c) configure Deployment Protection to bypass the
specific route.

**Reference commit:** `79e67ca fix(cron): call sendBrief in-process to avoid deployment-protection 401s`

---

## 3. Scheduled GitHub Actions workflow not firing automatically

**Date:** 2026-05-08 — ongoing

**Symptom:** `cron-dispatch-briefs.yml` is on `main`, registered as
`active` per `gh api`, manual `workflow_dispatch` runs fire and complete
in ~15 seconds. But the `schedule` trigger fires **zero times** over
~3 hours. Expected ticks at `*/15` boundaries (later changed to
`7,22,37,52`) — none in the run history.

**Diagnosis (best understanding so far):** Two compounding factors,
both documented in GitHub Community discussions:

1. **Onboarding throttle for brand-new accounts.** The repo owner
   account (`adityauphade-mac`) was created 3 days ago. There's
   anecdotal evidence that GitHub defers the first scheduled
   workflow-fire on new free-tier accounts. Not officially documented;
   confirmed by [community discussion #190423](https://github.com/orgs/community/discussions/190423)
   and similar threads from March 2026.

2. **Each commit-to-main resets the scheduler's onboarding window.**
   GitHub staff (SrRyan) in [discussion #185355](https://github.com/orgs/community/discussions/185355):
   > *"Any commit pushed to the default branch will resync the impacted
   > scheduled workflows."*
   The cut both ways: each "resync" commit may also restart the indexing
   timer.

**Workaround attempted (didn't help):**
- Pushed two `main` commits as resync triggers (PR #7, PR #8) — no auto-fire
- Switched cron from `*/15 * * * *` to `7,22,37,52 * * * *` to dodge the
  round-minute traffic jam — no auto-fire

**Current strategy:**
- **Stop pushing to `main`** for at least 6-24 hours
- Watch for the first auto-fire; checkpoints at 15:00 UTC today and
  09:30 UTC tomorrow
- **For the demo:** manually trigger via `gh workflow run cron-dispatch-briefs.yml`
- **If no auto-fire by 24h after the last `main` commit:** migrate to
  Vercel Cron (Pro plan, $20/mo) or Upstash QStash (free tier)

**Detection going forward:**
- `gh api repos/adityauphade-mac/vera-mvp/actions/runs?event=schedule --jq '.total_count'`
  returns 0 → still throttled or not picked up.
- When it starts working, that count climbs by ~96/day (15-min cadence).
- If you see an auto-fire and then it stops, that's a different
  problem — check GitHub status page first.

**Reference commit:** `ee2331a fix(cron): stagger dispatch trigger off the round-minute boundary`

---

## 4. Pushing workflow files needs `workflow` OAuth scope

**Date:** 2026-05-08

**Symptom:** `git push origin <branch>` rejected with:
```
remote: refusing to allow an OAuth App to create or update workflow
`.github/workflows/cron-dispatch-briefs.yml` without `workflow` scope
```

**Diagnosis:** GitHub requires the OAuth token used for git pushes to
have the `workflow` scope when the push touches anything under
`.github/workflows/`. The `gh` CLI's default token only requests
`repo`, not `workflow`.

**Fix:** One of:
1. `gh auth refresh -h github.com -s workflow` (browser device flow)
2. Generate a Personal Access Token with `repo` + `workflow`, use for
   that push only, then revoke
3. Use a different `gh` account that already has the scope

**Detection going forward:** any PR that adds, edits, or deletes a file
under `.github/workflows/` will hit this from any account that hasn't
granted `workflow` scope. The error message is unambiguous.

---

## 5. `next lint` removed in Next.js 16

**Date:** 2026-05-08

**Symptom:**
```
> @vera/web@0.1.0 lint
> next lint
Invalid project directory provided, no such directory: .../apps/web/lint
```

**Diagnosis:** Next.js 16 dropped the bundled `next lint` wrapper. The
existing `"lint": "next lint"` script in `apps/web/package.json` errors
because `next` doesn't recognize the subcommand and treats it as a
positional path arg.

**Fix:** Install ESLint 9 directly + flat config + plugin set
(typescript-eslint, eslint-plugin-react, eslint-plugin-react-hooks,
@next/eslint-plugin-next). Update script: `"lint": "eslint ."`.

Config lives at `apps/web/eslint.config.mjs`. Auth.js workaround files
get a file-scoped `no-explicit-any: off` override since the `any` types
are documented escape hatches for Auth.js v5 monorepo TS inference
issues.

**Detection going forward:** if you upgrade Next.js again and it ships
with a bundled lint wrapper, the manual config still works — just
prefer `eslint .` directly.

**Reference branch:** `chore/wire-eslint`

---

## 6. Vercel preview URL → 401 even though prod is reachable

**Date:** Earlier in the project

**Symptom:** `curl https://vera-<hash>-aditya-uphades-projects.vercel.app/`
returns 401, but `curl https://vera-mvp.vercel.app/` returns 200.

**Diagnosis:** Vercel's **Deployment Protection**. Per-deploy hashed
URLs require a Vercel SSO login by default. The canonical alias
(`vera-mvp.vercel.app`) is publicly reachable.

**This is a feature, not a bug.** It prevents preview deploys from
being indexed or shared accidentally. Don't disable it for the project.
For the cron use case, see entry **#2**.

---

## 7. Local typecheck fails after pulling main: missing PrismaClient

**Date:** Recurring

**Symptom:**
```
lib/db.ts(2,10): error TS2305: Module '"@prisma/client"' has no
exported member 'PrismaClient'.
```

**Diagnosis:** `pnpm install` ignores Prisma's `postinstall` script by
default (security feature in pnpm 10+). `@prisma/client` is empty until
`prisma generate` has run.

**Fix:**
```bash
pnpm --filter @vera/web exec prisma generate
```

The build script already does this (`"build": "prisma generate && next
build"`), but typecheck and dev mode don't. After a fresh
`pnpm install`, run `prisma generate` once.

**Permanent option:** `pnpm approve-builds` and select Prisma packages
to allow them to run install scripts. Then `pnpm install` runs
`prisma generate` automatically.

---

## How to add an entry

When you debug something that took non-trivial time, write it up here
**before you forget the diagnosis**. Template:

```md
## N. Short, googleable symptom

**Date:** YYYY-MM-DD

**Symptom:** what the developer saw — error message verbatim if possible.

**Diagnosis:** the actual root cause, not the symptom. What was happening
under the hood.

**Fix:** what worked. With code references / commit SHAs.

**Detection going forward:** how to tell if the problem is recurring.

**Reference commit:** `<sha> <message>`
```

The point of this doc is *prevention*, not just record-keeping. If
something in here happens twice, the entry needs to be sharper.
