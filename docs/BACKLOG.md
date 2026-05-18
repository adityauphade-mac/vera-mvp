# Backlog

The single source of truth for what's shipped, what's on deck, and what's
deferred. Consolidates the three earlier backlogs (`IMPROVEMENTS.md`,
`NEXT_FEATURES.md`, `docs/AR_BACKLOG.md`) into one living document.

> Last updated: 2026-05-14

---

## Recently shipped

Things that have landed in production. Listed newest first so the recency
of velocity is visible at a glance.

### 2026-05-14 — Database cutover day

| Done | Why it matters |
|---|---|
| **DB-only read path.** Every dashboard reads from the GCP `vera_prod` Postgres at request time. The legacy JSON snapshot path was retired in the 2026-05-18 JSON-removal change. | Dashboard numbers reflect the latest promoted backfill with no deploy required, and there's a single path to maintain instead of two. |
| **Push filter + aggregation into Postgres** (`getLiveARJobsWithContext`, `getLiveJobsForWriteOffs`). | Cold-request transfer dropped from 200 MB to 650 KB (~320×). The earlier cutover attempt failed because Vercel functions timed out shipping 200 MB on every cold start. |
| **Post-sync PDF email on backfill completion.** | Operators see *which* records flowed through a sync, not just the count. Attached to the existing sync-complete email. |
| **Skeleton loaders for every dashboard route.** | No more "Not scheduled" flashes on first load. |
| **Run-now bug fix** — picks incremental mode when prior completed runs exist, even without a `BackfillSchedule` row. | Operators clicking Run-now no longer re-fetch all 103k jobs every time. |
| **Playwright safety guard** — refuses to wipe a DB with promoted runs. | Test runner can no longer nuke real backfill output. We learned this the hard way today. |
| **`vera_prod` on GCP Cloud SQL** with a scoped `vera_app` role. Neon is abandoned. | Replaces the over-quota Neon project; bounded blast radius. |

### 2026-05-13 — Write-offs broadened

| Done | Why it matters |
|---|---|
| Write-offs scope expanded beyond AR working set to "all estimates, 2024+". 25 records ($139K) → 373 records ($2.26M). | Operators were missing actionable write-offs on paid-off jobs. |
| Status filter (Active AR / Paid off) on the write-offs page. | Read the broadened dataset without losing the AR-focused view. |

### 2026-05-12 — Write-offs dashboard

| Done |
|---|
| Write-offs dashboard (page + API + sidebar nav + drill-down sheet) |
| Customer column + install date (MM/DD/YYYY) added across Aging, Milestones, Follow-ups |
| Backfill scheduling system (Run-now, schedules, tick worker, QStash, atomic promote) |

### Earlier shipped (chronological roll-up)

- 2026-05-08 — Audit log + ConfirmDialog + skeleton-first loading + favicons (PR #16)
- 2026-05-07 — Mobile responsiveness (drawer nav, horizontal scroll tables, 375px-no-overflow asserted)
- 2026-05-06 — Brandon demo deployed at https://vera-mvp.vercel.app
- 2026-05-05 — First production deploy

---

## Active

What's genuinely next. Each item names the user value, the rough effort, and
the open questions. Items leave this section when they ship (move to "shipped")
or get explicitly deferred.

### Recurring backfill schedules on production

**Why:** the DB cutover is live but `BackfillSchedule` is empty in production.
Without a schedule, the data freezes at the most recent manual Run-now.

**Scope:** create two daily `BackfillSchedule` rows on prod via
`/dashboard/scheduler` — one for `rooflink_jobs`, one for `rooflink_lineitems`.
Off-peak hours (e.g. 02:00 and 04:00 Central). With today's Run-now fix, the
first scheduled run will correctly pick incremental mode.

**Effort:** ~10 min via UI. No code changes.

### JSON-path cleanup — DONE (2026-05-18)

Closed by the JSON-removal PR. The two JSON snapshot files were
deleted, the `USE_DB_DATA_SOURCE` flag is gone, the dispatcher in
`lib/data.ts` / `lib/write-offs-data.ts` collapsed to DB-only, the
backfill JSONL fallback was removed, and the obsolete scripts
(`preprocess.ts`, `fetch-write-offs.ts`, `verify-data.ts`, the
`test-cheap-sql-*.mjs` trio) were deleted. See
[`JSON_REMOVAL_PLAN.md`](JSON_REMOVAL_PLAN.md) for the original plan
and the `2026-05-18` entry in [`RELEASE.md`](RELEASE.md) for the
deploy record.

---

## Deferred — UI / UX

Lifted from `NEXT_FEATURES.md`. Brandon's post-demo asks. Re-prioritize with
him after the DB-cutover dust settles.

| Item | Effort | Notes |
|---|---|---|
| Card height uniformity on milestones / follow-ups / reconciliation | ~1 h | Move milestones + reconciliation to Table primitive; 2-line clamp on follow-ups (the Draft-email button needs vertical room). |
| Ask Vera FAB attention treatment | ~1 h | Pulsing ring + first-visit tooltip. Keep side-sheet over centered modal. |
| Rep Outstanding → Rep Leaderboard | ~3-4 h | 7-metric × 4-period picker. URL-driven so views are shareable. See `docs/_history/NEXT_FEATURES.md` for the metric matrix. |
| Per-table FilterMenu | ~3-4 h | One shared `<FilterMenu>` + URL state via `nuqs`. Applied across 5 dashboard pages. |
| Reconciliation "installed N days ago" copy still stale | ~15 min | Inconsistency, not a bug. |
| Mobile responsiveness page-by-page review | ~half day | Walk every page on a real phone. Baseline screenshots already at `tests/e2e/audit-screens/`. |

## Deferred — Platform

Architectural / out-of-scope-for-MVP items. Each requires its own design pass.

| Item | Why it's deferred |
|---|---|
| **PI / agentic-AI architecture** (goal-oriented tools, model-agnostic provider switching) | Out of AR scope. Needs design pass with Israel before any code. |
| **Multi-recipient email notifications** | Single-user-per-workspace today. Multi-recipient is a notification feature, not an AR feature. |
| **Multi-user workspace access** | No identity/permissions work in the current sprint. |
| **QuickBooks integration** | Mentioned as a downstream use case for PI. Not standalone work yet. |
| **Trend analysis (monthly task #7)** | Originally out of scope per `SPEC.md`. |
| **Departed rep audits (monthly task #8)** | Same. |
| **End-of-month close (monthly task #9)** | Same. |
| **Mobile-first layouts** | Desktop-first per `CLAUDE.md`. Mobile tables already horizontal-scroll, sufficient for MVP. |

## Deferred — Tech debt

Papercuts. Address opportunistically; none are blockers.

- `pnpm approve-builds` for Prisma (silent postinstall block in fresh worktrees).
- Audit-logs / follow-ups e2e spec gaps.
- `apps/web/scripts/` accumulates tooling that could be moved out of the app workspace.

---

## Recent decisions worth remembering

These are non-obvious choices that affect future work. Capture them here so
they don't have to be rediscovered.

| When | Decision | Why |
|---|---|---|
| 2026-05-14 | Filter + aggregate the DB read path in SQL (Postgres pushdown), keep domain transforms in TypeScript | Best of both: tiny transfer (650 KB vs 200 MB) without duplicating heat-score / anomaly logic into SQL. |
| 2026-05-14 | Abandon Neon entirely instead of migrating; use GCP Cloud SQL with a new scoped `vera_app` role | Neon quota was exhausted; GCP was already available; scoped role limits blast radius. |
| 2026-05-13 | Broaden write-offs from AR-only to all-estimates with a 2024+ install-date filter | Operators acted on paid-off jobs too; AR filter was too narrow. 25 → 373 records. |
| 2026-05-13 | `BackfillRun` is append-only; new runs add rows with a fresh `dataVersion`, never overwrite | Atomic promote (flip `promoted=true`) gives consistent dashboard snapshots with zero half-loaded states. |
| 2026-05-12 | Use GitHub Actions cron (not Vercel cron) for the scheduler | Hobby Vercel cron caps at 2 jobs / 1× daily; can't run a 15-min sweeper. |
| 2026-05-08 | Move from inline banners to sonner toasts + `useConfirm` for all transient feedback | Per `CLAUDE.md` rule #11 — no native dialogs, no inline transient `<div>`s. |
| 2026-05-07 | Net 60 for insurance jobs, Net 30 for retail | `SPEC.md` Q3. Drives `daysPastTerms` and aging buckets. |
