# Vera — Release notes

What's been deployed to production, when, and what's pending.

> Last updated: May 11, 2026.

---

## Currently in production

- **URL:** https://vera-mvp.vercel.app
- **Last verified deploy:** see Vercel dashboard for the active production deployment.
- **Branch deployed:** `main`
- **Smoke checks passing:** see [`OPERATIONS.md`](./OPERATIONS.md#deploy-to-production)

---

## Deploy cadence

There is no formal release cycle. We deploy on demand:

- **Auto-deploy on push to `main`** (Vercel Git integration)
- **Manual deploy:** `vercel --prod --yes` from the repo root
- **Rollback:** `vercel rollback <previous-deployment-url>`

Most pushes to `main` are small, focused commits — a typical day has
several deploys.

---

## Currently unmerged branches

These exist on `origin` but are not yet on `main`. None affect production
runtime today:

| Branch | What it is | Why it's not merged yet |
|---|---|---|
| `chore/wire-eslint` | ESLint flat config + cleanup of 3 unused imports + dead `eslint-disable` directives | Holding until cron behavior stabilizes — see TROUBLESHOOTING_HISTORY |
| `fix/scheduler-disabled-state-and-banner` | Scheduler page: paused-row inputs disable + tooltip; cron-delay banner | Same reason — staged for next merge window |

---

## Release log

Reverse-chronological. Each entry has the merge SHA on `main`, the date,
and a short summary of user-visible behavior change.

### PR #13 · 2026-05-11 — Scheduler natural-key + QStash migration

Two compounding bugs fixed in one PR.

**Scheduler was duplicating rows.** Every save on the scheduler page
POSTed a new `Schedule` row. Eleven daily rows had accumulated for
tenant 1 by May 10, and a single dispatch tick was firing 8 emails at
once. Fix: enforced `(tenantId, cadence)` as a DB-level natural key
(unique index), rewrote the API as `PUT/DELETE /api/schedules/[cadence]`
(upsert/delete on the natural key), and rebuilt the scheduler UI around
three explicit states (Unscheduled / Scheduled / Paused) with one
primary action each. Pausing now fires an immediate optimistic PUT to
the server — no more "I toggled off but it still says scheduled"
dead-end. Form stays editable when paused. Save is dirty-aware. Remove
is a quieter ghost button. Paused cards dim to 60% opacity for
at-a-glance scanning.

**Cron was unreliable.** GitHub Actions cron was delivering ~5% of the
96 ticks/day we asked for, with multi-hour gaps. Migrated to Upstash
QStash, which fires within seconds of any cron tick. Added
`apps/web/lib/cron-auth.ts` that verifies QStash JWT signatures via
`@upstash/qstash` against `QSTASH_CURRENT_SIGNING_KEY` /
`QSTASH_NEXT_SIGNING_KEY`. A legacy `Authorization: Bearer $CRON_SECRET`
fallback is retained for manual `curl` triggering. Two QStash schedules
now drive the cron: `dispatch-briefs` at `*/5 * * * *` (every 5 min),
`generate-briefings` at `0 12 * * 1-5` (12:00 UTC Mon–Fri).

**Cleanup.** The two `.github/workflows/cron-*.yml` files are deleted —
replaced entirely by QStash schedules. The "Automatic dispatch may be
delayed" warning banner is removed from the scheduler page; the cron
is now reliable enough that the disclaimer is misleading. All docs
referencing GitHub Actions cron updated to QStash.

User-visible change: emails arrive within ~5 minutes of their scheduled
time, every time. Editing a scheduled cadence's recipient now replaces
the row in place — no more duplicate sends.

### `614e7312` · 2026-05-08 09:28 UTC — `fix(cron): stagger dispatch trigger off the round-minute boundary`

Cron expression for `cron-dispatch-briefs.yml` changed from `*/15 * * * *`
to `7,22,37,52 * * * *`. Same cadence; off-peak minutes sidestep
GitHub's "round-minute traffic jam" issue. **No runtime change** for the
app — only how often GitHub Actions fires the dispatcher.

### `1b8068e` · 2026-05-08 ~08:55 UTC — `docs: infrastructure runbook + operations guide`

Added `docs/INFRASTRUCTURE.md` and `docs/OPERATIONS.md`. **No runtime
change.** The merge itself was a "fresh commit to main" intended to
trigger GitHub's scheduler-resync per their staff-suggested workaround.

### `f9ad29e` · 2026-05-08 08:24 UTC — PR #6: `fix(cron): in-process sendBrief call`

Discovered by the first cron-dispatch run on prod: the dispatcher was
calling `/api/brief/send` via HTTP at `process.env.VERCEL_URL`, which
resolves to the hashed preview URL behind Vercel's Deployment
Protection. Result: every send returned 401.

Fix: extracted a `sendBrief()` function from the route handler. The
dispatcher and HTTP route now both call it directly — no HTTP roundtrip,
no auth dance.

User-visible change: scheduled brief deliveries actually deliver on prod.

### `ad41af5` · 2026-05-08 ~08:23 UTC — PR #5: foundational ship

The big merge. Multi-tenant auth, Postgres, AI briefing, real
scheduling, exit animations, mobile chip overflow fix, Playwright
revival with JWT auth helper. ~10 commits squashed worth of work.

User-visible: most of what's on prod today.

### `53d5522` · 2026-05-07 (date pending verification) — PR #4: `fix(chat)`

Customer-name surface bug + tighter listJobs prompt. Made via squash
merge before today's session.

### Earlier history

Pre-PR #4 history is in the git log. See `git log main` for full detail.

---

## Open items

Not deployed today. Tracked in `IMPROVEMENTS.md` for the full backlog.

- **GH Actions scheduler not auto-firing.** Investigation in
  `TROUBLESHOOTING_HISTORY.md` entry #3. Two open paths: wait through
  GitHub's onboarding throttle, or migrate the cron to Vercel Cron or
  another scheduler.
- **`fix/scheduler-disabled-state-and-banner`** — pushed branch, not
  merged. Contains the scheduler paused-row UX + cron-delay banner.
- **`chore/wire-eslint`** — pushed branch, not merged. Adds an ESLint
  flat config and clears the small set of lint warnings the new config
  surfaces.
- **RoofLink data sync** — not built. `backfill.py` (in repo root) is
  the reference implementation Israel shared.

---

## Versioning

We don't ship versioned releases (no SemVer tags, no GitHub releases).
The deployed `main` SHA *is* the version. Use `vercel inspect <url>` to
see the exact SHA + timestamp for any deployment.

If you need a stable reference for a demo or a customer touchpoint:

```bash
# capture the current prod SHA
vercel ls --prod | head -2
git rev-parse origin/main
# write them down somewhere referenceable
```
