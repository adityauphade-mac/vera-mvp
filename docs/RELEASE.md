# Release notes

What's been deployed to production, when, and what's pending.

> Last updated: 2026-05-18 (timezone leak fix — pending)

---

## Currently in production

- **URL:** <https://vera-mvp.vercel.app>
- **Database:** GCP Cloud SQL `vera_prod` at `34.56.121.151:5432`
- **Read path:** DB (`USE_DB_DATA_SOURCE=1`)
- **Branch deployed:** `main`
- **Latest deployment hash:** check `vercel ls --prod | head -2`

---

## Deploy cadence

No formal release cycle. We deploy on demand from the canonical repo:

```bash
cd /Users/aditya-levich/Build/israil_mvp
vercel --prod --yes
```

Auto-deploy is broken until the `hexabytecode` ↔ `adityauphade-mac`
identity mismatch on Vercel is fixed (see entry #1 in
[`TROUBLESHOOTING_HISTORY.md`](TROUBLESHOOTING_HISTORY.md)). Until then,
manual deploy after every merge to `main`.

---

## Release log

Reverse-chronological. Each entry describes the user-visible behavior change.

### 2026-05-18 — Timezone leak fix: dashboard dates in browser TZ, PDFs in tenant TZ

**Pending.** Branch `fix/timezone-leaks`, commit `2350c13`. PR to be opened.

Five surfaces were rendering dates in UTC instead of the viewer's local time. Server components were formatting with `toLocaleDateString` (Node runtime = UTC on Vercel) and email PDFs were stamping `now.toISOString().slice(0,10)` for filenames — every viewer saw the UTC date regardless of where they sat.

What users will see change:
- **Dashboard "As of" header** (top of every `/dashboard/*` page) — now formatted client-side in browser TZ. Crosses midnight correctly in different timezones. SSR briefly shows the YYYY-MM-DD fallback before hydration swaps in the formatted weekday (~50–100ms flash on initial load).
- **Daily brief email subject + PDF header + filename** — now in the tenant's `briefingTimezone` (Chicago). Sending at 11pm Central no longer stamps the next UTC day.
- **Sync summary email PDF header + "Installed" date column + filename** — same treatment.

What's NOT changing:
- Aging buckets, write-off totals, audit log entries, job tables — already correct (computed from date-only fields or rendered in client components without an explicit `timeZone`).
- No DB migration. No schema change. Code-only.

How it was done:
- `apps/web/app/dashboard/_components/AsOfDate.tsx` — new client component for the header.
- `apps/web/lib/daily-brief-pdf.tsx`, `apps/web/lib/sync-summary-pdf.tsx` — accept `timeZone` parameter; emails ship as finished artifacts so the TZ has to be embedded at render time.
- `shared/domain/src/daily-brief.ts` — `buildDailyBrief` accepts optional `timeZone` (defaults to `America/Chicago`); the email subject and subtitle now read in that zone.
- Callers (`apps/web/app/api/brief/send/route.ts`, `apps/web/lib/backfill/tick-worker.ts`, the on-demand sync-summary route, the email preview script) fetch `tenant.briefingTimezone` and pass it through.
- Filenames use `Intl.DateTimeFormat('en-CA', {timeZone, …})` instead of `toISOString().slice(0,10)`.

Test coverage:
- New `tests/e2e/timezone-rendering.spec.ts` — 9 tests pinning the browser context to Pacific, Eastern, and Tokyo. The Tokyo cases cross the UTC date line, so any regression to server-side formatting (or a `formatUSDate`-style helper that goes through a server runtime) flips those assertions.
- Full suite: 158 passed, 1 unrelated skip. Typecheck clean.

Rollback: code-only, `git revert <merge-sha> && vercel --prod --yes`. No DB to undo.

Already-queued briefs in Resend (with `scheduled_at` in the future) had their PDF rendered + attached at queue time, so they'll deliver the pre-fix format. Only briefs triggered after deploy get the new behavior.

### 2026-05-18 — JSON read path removed; tests run against `vera_test`

**Deployed.** Merge commit `760d973` on `main` (PR [#24](https://github.com/adityauphade-mac/vera-mvp/pull/24), 6-commit chain `5188356` → `178a0f6`). Vercel deployment `dpl_A9VVYuzdLmzw1WRbARaKVg4i73nb`, aliased to <https://vera-mvp.vercel.app>. Post-deploy smoke: public 200, auth-gated dashboard 307→/login, auth-gated APIs 401. Dashboard math unchanged — 130 AR jobs / $1,278,629.33 and 371 write-offs / $2,249,028.95, byte-for-byte the same as pre-deploy. No user-visible behavior change; the architecture under it collapses from "two paths gated by a flag" to one. Carried out per [`JSON_REMOVAL_PLAN.md`](JSON_REMOVAL_PLAN.md).

What changed:
- The build-time JSON snapshot path (read from `apps/web/data/generated.json` and `write-offs.json`) is gone. Both `lib/data.ts` and `lib/write-offs-data.ts` read from Postgres directly. The `USE_DB_DATA_SOURCE` env flag will be removed from Vercel + `.env.prod` after the deploy lands.
- The JSON files themselves are deleted. `apps/web/data/generated.json` was byte-identical to the Playwright fixture; `write-offs.json` moved to `tests/fixtures/write-offs.fixture.json` (used only by the test-seed regenerator).
- The backfill `loadEstimatesFromJsonl()` fallback at [`apps/web/lib/backfill/rooflink.ts`](../apps/web/lib/backfill/rooflink.ts) is gone. Without a promoted `rooflink_jobs` run, lineitems syncs now throw a clear error instead of falling back to a 196 MB local file that's gitignored + vercelignored anyway.
- Scripts cleanup: deleted `preprocess.ts`, `fetch-write-offs.ts`, `verify-data.ts`, `test-cheap-sql.mjs`, `test-cheap-sql-local-pg.mjs`, `test-cheap-sql-via-jsonl.mjs`. `package.json` no longer chains a `preprocess` step into `build`.
- Test scaffolding: Playwright now runs against a dedicated **`vera_test`** Postgres DB seeded from `tests/fixtures/vera_test.sql` (1 MB, checked in, regenerable). `globalSetup` enforces a strict DB-name guard — refuses to wipe anything but `vera_test` on `localhost`, no override flag. Test runner pins port 3001 so `pnpm dev` on 3000 can coexist.

Test suite result: 149 passed, 1 skipped, 0 failures across the chain. Verified end-to-end against the local stack pulling real Rooflink data into `vera_test` post-watermark-fix — produced the same dashboard numbers prod currently shows (371 write-offs / $2.25M), confirming the local path mirrors prod exactly.

Rollback: `git revert` the merge commit. The JSON files and the dispatcher come back together; nothing in the DB changes. Re-adding `USE_DB_DATA_SOURCE=1` to Vercel after the revert is a no-op since the revert restores both paths and the flag.

### 2026-05-18 — Write-offs mock-data incident (no-deploy recovery)

**Recovered.** Production env edit + targeted SQL on `vera_prod`. No code deploy, no migration. Reported by Israil — `/dashboard/write-offs` showed `$0 / 0 jobs` against `2208 jobs scanned` from Saturday afternoon through Monday morning IST.

**Root cause.** `RL_KEY` (the Rooflink API key) was missing from the Vercel production environment. The backfill client at [`apps/web/lib/backfill/rooflink.ts:19`](../apps/web/lib/backfill/rooflink.ts#L19) treats missing `RL_KEY` as "dev mode" and silently returns mock fixture data — for `rooflink_lineitems` the fixture is exactly 40 synthetic rows named `rooflink_lineitems-mock-00000` etc. The key was almost certainly removed during the [2026-05-14 Neon-cleanup pass](#2026-05-14--multi-recipient-notifications--audited-follow-up-email-send) — that session removed 13 env vars in a batch and `RL_KEY` got swept up alongside the deprecated Neon ones. It also didn't get carried over into `.env.prod` when the recovery file was first built (file was sourced from "what Vercel currently has" post-cleanup, not from "what the app actually reads").

**Why the rooflink_lineitems snapshot got poisoned.** The cron dispatcher at [`apps/web/app/api/cron/dispatch-briefs/route.ts:290`](../apps/web/app/api/cron/dispatch-briefs/route.ts#L290) picks `mode = sch.lastSyncedAt ? 'incremental' : 'full'`. The `BackfillSchedule` row for `rooflink_lineitems` was created on 2026-05-15 12:38 IST, *after* the existing manual `rooflink_lineitems` runs had already completed (those runs had `scheduleId = NULL`). `advanceWatermark` updates `BackfillSchedule WHERE (tenantId, source)` — for the manual runs the schedule row didn't exist yet, so `updateMany` matched zero rows and `lastSyncedAt` stayed NULL on the freshly-created schedule. Saturday's 2026-05-16 12:00 IST cron firing therefore picked `mode = 'full'`. The full-sync branch in [`tick-worker.ts:474`](../apps/web/lib/backfill/tick-worker.ts#L474) demotes every other promoted run for the source — that's how mock run #149 (40 rows) replaced the real run #135 (8,434 rows) as the live snapshot.

**Recovery.**
1. **`RL_KEY` restored in Vercel prod** via `vercel env add RL_KEY production` (value from canonical local `apps/web/.env.local`). Fluid Compute reads env per-invocation, so no redeploy was needed to make subsequent backfill ticks hit the real API.
2. **Snapshot swapped back** with a single transaction on `vera_prod`:
   ```sql
   BEGIN;
   UPDATE "BackfillRun" SET promoted = false WHERE id = 149;
   UPDATE "BackfillRun" SET promoted = true  WHERE id = 135;
   DELETE FROM "RawRooflinkLineItems" WHERE "dataVersion" = 149;
   COMMIT;
   ```
   Re-promotes the 2026-05-13 manual full-sync snapshot (8,434 real line-item payloads from the live Rooflink API), demotes the Saturday mock run, and prunes the 40 mock rows so no future code path can accidentally pick them up.
3. **`.env.prod` rebuilt** with `RL_KEY` added under the "Third-party API keys" section and the "Last reconciled" date bumped. Confirmed `.env.prod` now matches Vercel prod exactly for all user-set keys (18 keys, diff is empty after excluding platform-injected `VERCEL_*` / `TURBO_*` / `NX_DAEMON`).

**Verification.** Post-fix simulation of the write-offs join against the restored snapshot returned **373 records / $2,259,638.77 total amount withheld** — matches the historical `apps/web/data/write-offs.json` (May 13 build-time snapshot) to the penny. Zero `skipped404` rows (every one of the 2,208 candidate jobs found a matching line-item payload). Israil confirmed the dashboard surface shows the restored numbers.

**Rollback path.** None of the changes are deploys; rollback is just reversing the SQL (`UPDATE` flags back, `INSERT` the 40 mock rows back — though there's no reason to do this). `RL_KEY` can be removed again via `vercel env rm RL_KEY production` if needed.

**Code fix shipped same day — watermark hygiene.** Commits `e987892` (fix) + `536931a` (plan doc) on `main`, Vercel deployment `dpl_AKWoz7R7Px3thLVMu4aWZT4bqLy6`, aliased to <https://vera-mvp.vercel.app>. Smoke: public 200, auth-gated dashboard 307→/login, auth-gated API 401 — all as expected.

`advanceWatermark` now skips when `itemsProcessed === 0` (an empty incremental no longer advances `BackfillSchedule.lastSyncedAt`), and the Run-now route's watermark query now filters by `promoted = true` (an unpromoted run — including empty short-circuits — no longer counts as a watermark source). Together these mean: a `rooflink_lineitems` incremental that decides locally "no jobs changed, nothing to refetch" no longer claims we're synced through "now"; it leaves the watermark on the last *actually-fetched* run. Without this, future incrementals could silently skip the unverified window. Same defect would have masked Saturday's mock-data poisoning faster if it had been in place.

Files:
- `apps/web/lib/backfill/tick-worker.ts` — `advanceWatermark` gated on `itemsProcessed > 0`.
- `apps/web/app/api/backfills/[source]/runs/route.ts` — watermark query filters `promoted: true`.

After this lands, the next `rooflink_lineitems` Run-now derives its watermark from run #135's `startedAt` (2026-05-13 14:26 IST) — the last lineitems run that actually pulled real Rooflink data — instead of the empty-incremental short-circuit at 2026-05-17 12:00 IST. So an incremental can find real estimate edits since May 13 rather than seeing an artificially-narrow May 17→now window where nothing could have changed in our stale jobs snapshot.

**JSON-removal follow-up planned.** `docs/JSON_REMOVAL_PLAN.md` captures the next PR — remove the dormant JSON read path, the JSONL backfill fallback, and the `USE_DB_DATA_SOURCE` flag; tests move to a dedicated `vera_test` Postgres DB seeded from checked-in SQL. ~1 working day of effort, sequenced so each commit leaves the repo green.

**Follow-ups still to file** (separate tasks):
- **Fail-fast on missing `RL_KEY` in production.** `apps/web/lib/backfill/rooflink.ts:69` (`isLiveMode`) should throw in `NODE_ENV=production` when `RL_KEY` is unset, not silently substitute mock data. Mock-mode is for dev only and should never run unannounced in prod.
- **Dispatcher should mirror Run-now's watermark logic.** The cron path uses `BackfillSchedule.lastSyncedAt`; the Run-now endpoint correctly derives the watermark from `BackfillRun` directly. If the cron used the same rule, Saturday would have correctly chosen `incremental` and this incident wouldn't have happened.
- **Size-regression guard in `promote()`.** A full-sync promote that shrinks the live row count by more than ~10× should require an explicit override flag or at least audit-log the delta loudly. Run #149 dropped the live count from 8,434 → 40 with no signal anywhere.
- **Env-presence check in deploy.** Build a small assertion list (probably typed in `apps/web/lib/env.ts`) of variables the app *must* have in prod, and run it from CI / as a smoke check after every `vercel --prod`. Today there's no enumerated kill-list — `.env.prod` was sourced from Vercel rather than from a canonical schema, which is what allowed `RL_KEY` to disappear silently.
- **Use observed `date_last_edited` as watermark instead of `startedAt`.** Part-2 follow-up to today's fix. Stronger semantics: "we've definitely seen all edits up to T_max" requires tracking the max observed timestamp during the fetch. Today's gate (`itemsProcessed > 0`) closes the immediate bug; this would tighten it further.

### 2026-05-15 — Automation rules + RHF standardization

**Deployed.** Merge commit `9d4dec0` on `main` (PR [#23](https://github.com/adityauphade-mac/vera-mvp/pull/23)). Follow-up grant fix `b0301f1` (no PR — applied directly to main). Vercel deployment `dpl_9Q2b3hwb9nfn8woARgXVdgp8oLQp`, aliased to <https://vera-mvp.vercel.app>. Migration `20260515150000_add_automation_rules` applied to `vera_prod` before the code deploy; follow-up hotfix `20260515170000_grant_automation_rules_to_vera_app` granted DML on the new tables to `vera_app` (same lesson as PR #22's LiveJob hotfix). Production verification: all four public routes 200, all 11 auth-gated dashboard routes (including `?tab=automation`) 307-redirect to `/login`, all 13 auth-gated API routes return 401 (route exists + DB grants correct — would be 500 otherwise). Manual end-to-end smoke (rule → Evaluate now → Approve → email → audit row) deferred to live demo by the operator.

New tab at `/dashboard/scheduler?tab=automation`. Operators author rules that watch one of three AR metrics — `aging_days`, `balance`, `heat_score` — for a state transition and propose an email into a human-approval queue (Pattern B). Three operators: `crosses_above`, `crosses_below`, `stays_above_for_n_days`. Recipient is either the rep assigned to the job (looked up dynamically per fire via `ARJob.rep.email`) or a fixed test email. Each rule carries its own subject + body template with `{{placeholder}}` interpolation; templates are collapsed under a "Customize the email Vera proposes" disclosure by default. Per-rule `dailySendCap` (default 25) prevents avalanches.

The evaluator hooks into `tick-worker.ts` immediately after `promote()` so rules fire once per successful promoted backfill (and after the `LiveJob` refresh, so it reads the freshest snapshot). The hook is wrapped in try/catch — a misbehaving rule cannot roll back a promoted backfill. A manual "Evaluate now" button on the automation tab lets operators flush the queue between syncs.

Pending sends surface in a queue below the rule list. Each card shows the trigger reason, recipient, subject preview, and expandable body. Single Approve / Reject per row + bulk Approve all / Reject all with a progress toast that updates in-place. Approving routes through the existing `sendEmail` pipeline (Resend) and audit log; rejecting captures the decision. The queue auto-refreshes after Evaluate now without a page reload.

*RHF standardization.* Every form in the app now uses `react-hook-form` + `zodResolver` against a canonical schema in `shared/types/src/forms/` — `DraftEmailButton`, `SchedulerView` (three per-cadence schedule editors + nuqs-driven `?tab=` URL state), `DataSyncSection` (two per-source backfill schedule editors), and the new `AutomationRuleModal`. Same schema validates the client form and the API route body. New `@vera/ui` primitive `Form` / `FormField` / `FormItem` / `FormControl` / `FormMessage` adds inline per-field error rendering with proper per-field `useFormState` subscription.

**Schema migrations:**
- `20260515150000_add_automation_rules` — `AutomationRule`, `RuleEvaluationState`, `PendingRuleSend`. Indexed on `(tenantId, enabled)` for rule list and `(tenantId, status, createdAt)` for the pending queue. ON DELETE CASCADE on rule FKs.
- `20260515170000_grant_automation_rules_to_vera_app` — SELECT/INSERT/UPDATE/DELETE on the three tables + USAGE/SELECT on their id sequences. Idempotent via `DO` block + `pg_roles` check so a fresh local DB without `vera_app` doesn't fail.

**Audit:** new `automation_rules` category with actions `created`, `updated`, `deleted`, `enabled`, `disabled`, `evaluated`, `pending_approved`, `pending_rejected`, `pending_expired`, `pending_send_failed`. `AuditDetailSheet` renders an action-specific detail body for each, surfacing trigger metric, recipient, subject/body preview, error messages on send failure, and rejection reason.

**Rollback:** disable rules via the per-rule toggle on the automation tab; reject pending sends en masse with the queue's "Reject all" button. To revert the migration: drop the three tables in reverse FK order (`PendingRuleSend` → `RuleEvaluationState` → `AutomationRule`), then `DELETE FROM _prisma_migrations WHERE migration_name LIKE '%automation_rules%'`. `SendLog` rows produced by approved sends are preserved (`sendLogId` becomes a dangling reference but `SendLog` itself is untouched). `vercel rollback` reverts the code without touching the DB — tables are inert without code.

*Automation rules.* New tab at `/dashboard/scheduler?tab=automation`.
Operators author rules that watch one of three AR metrics — `aging_days`,
`balance`, `heat_score` — for a state transition and propose an email
into a human-approval queue (Pattern B). Three operators:

- `crosses_above` — was below threshold, now ≥ threshold → fires once.
- `crosses_below` — was ≥ threshold, now below → fires once.
- `stays_above_for_n_days` — ≥ threshold continuously for N days, then
  re-fires every N days until the metric drops.

Recipient is either the rep assigned to the job (looked up dynamically
per fire via `ARJob.rep.email`) or a fixed test email. Each rule carries
its own subject + body template with `{{placeholder}}` interpolation.

The evaluator hooks into `tick-worker.ts` immediately after `promote()`
so rules fire once per successful promoted backfill. Per-rule daily send
cap (default 25/day) prevents a misconfigured threshold from avalanching
the queue. Pending rows surface in a queue below the rule list; Approve
routes through the existing `sendEmail` pipeline and audit log; Reject
captures the decision. Missing-recipient rows render with an inline
email override input.

*RHF standardization.* Every form in the app now uses
`react-hook-form` + `zodResolver` against a canonical schema in
`shared/types/src/forms/`:

- `DraftEmailButton` (follow-ups compose modal).
- `SchedulerView` (three per-cadence schedule editors + nuqs-driven
  `?tab=` URL state for the report / sync / automation tabs).
- `DataSyncSection` (two per-source backfill schedule editors).
- New `AutomationRuleModal` for the rule builder.

Same schema validates client form and the API route body — single source
of truth in `@vera/types`. New `@vera/ui` primitive `Form` /
`FormField` / `FormItem` / `FormControl` / `FormMessage` adds inline
per-field error rendering across all forms.

**Schema migration:** `20260515150000_add_automation_rules` adds
`AutomationRule`, `RuleEvaluationState`, `PendingRuleSend`. Indexed on
(tenantId, enabled) for rule list and (tenantId, status, createdAt) for
the pending queue. ON DELETE CASCADE on rule FKs so removing a rule
cleans up its state + pending rows.

**Audit:** new `automation_rules` category with actions `created`,
`updated`, `deleted`, `enabled`, `disabled`, `evaluated`,
`pending_approved`, `pending_rejected`, `pending_expired`,
`pending_send_failed`. AuditDetailSheet renders an action-specific
detail body for each.

**Rollback:** disable all rules via the toggle on the automation tab;
reject pending sends en masse. Reverting the migration requires SQL
drops of the three tables in reverse FK order:
`PendingRuleSend` → `RuleEvaluationState` → `AutomationRule`. No data
loss outside the rule-related rows themselves (SendLog rows produced by
approved sends are preserved).

---

### 2026-05-15 — Narrated demo video on the landing page

**Deployed.** Merge commit `2c7b976` on `main` (PR [#21](https://github.com/adityauphade-mac/vera-mvp/pull/21)). Vercel deployment `dpl_2c1snwAT29QxkfZAtHCjGZz6EWtC`. Verified live on <https://vera-mvp.vercel.app>: both `<video>` elements in DOM, MP4s + posters serve `200 OK` with correct content-types (`video/mp4`, `image/jpeg`).

A 62-second autoplaying demo video now sits in the landing-page hero, between the Vera headline + CTA buttons and the "What I do, every morning" feature cards. Two renders behind the Tailwind `md:` breakpoint — landscape (1920×1080) for tablet/desktop, portrait (1080×1920) for mobile — walking through fourteen scenes that mirror Vera's real surfaces: sign-in, the morning briefing, heat distribution across active jobs, aging, milestones, follow-ups, reconciliation, the rep leaderboard, write-offs, scheduler cadence, audit log, and a drafted follow-up email. Closes on the brand mark with "Hours back. Leaks closed."

Narration is `af_heart` (Kokoro TTS, generated locally — no API key, no per-request cost), split into fourteen per-scene `<audio>` clips on tracks 20–33 of each composition so speech stays aligned to visuals across renders. The video plays muted-autoplay on load (every modern browser blocks audio autoplay without a user gesture); a floating "Tap to unmute" button in [`apps/web/app/_components/DemoVideo.tsx`](../apps/web/app/_components/DemoVideo.tsx) unmutes only the visible cut and seeks to `t=0` so the visitor hears the narration from the top rather than mid-sentence. The hidden cut stays paused so its audio pipeline never doubles up with the active video.

Composition sources live under [`hyperframes/landing-demo/`](../hyperframes/landing-demo/) (landscape) and [`hyperframes/landing-demo-mobile/`](../hyperframes/landing-demo-mobile/) (portrait). Re-render either with `npx hyperframes render` in the respective directory. Narration WAVs are checked in under `narration/s01.wav` … `s14.wav`; `narration/batch_synth.py` regenerates them from `narration/lines.txt` if the script changes.

**Rollback:** revert the merge commit and re-run `vercel --prod --yes` from the canonical repo, or `vercel rollback` to the previous production deployment. No DB migrations, no env-var changes, no API surface change — frontend asset addition only (~12 MB total across both MP4s + posters in `apps/web/public/`).

---

### 2026-05-15 — `LiveJob` materialized view

**Deployed.** Merge commit `25ee43e` on `main` (PR [#20](https://github.com/adityauphade-mac/vera-mvp/pull/20)). Vercel deployment `dpl_BMcGTRVESZMy96Jy4kuF3BEM8BXE`. Migration `20260515000000_add_livejob_materialized_view` applied to `vera_prod` before code deploy. Empty-promoted-incrementals cleanup SQL ran post-deploy (demoted 5 stale runs).

Dashboard read path moved from `SELECT DISTINCT ON ... FROM RawRooflinkJob` (parsing JSONB on every request) to a Postgres materialized view (`LiveJob`) with the AR/write-offs filter fields and the duplicate-address count extracted as proper indexed columns. The user-visible effect is **faster pages**, especially right after a backfill sync:

- AR endpoints (`/api/jobs/aging` and four siblings): post-promote cache miss dropped from ~900 ms to ~30 ms (~30× faster).
- Write-offs (`/dashboard/write-offs`): post-promote cache miss dropped from ~1100 ms to ~340 ms (~3× faster).
- Raw query time fell from ~1200 ms to ~1 ms (measured with EXPLAIN ANALYZE on `vera_dev`).

Cost moved (not added): `REFRESH MATERIALIZED VIEW CONCURRENTLY "LiveJob"` runs inside `tick-worker.promote()` after each non-empty `rooflink_jobs` promote. Takes ~3 s on 100 k rows but runs on the backfill worker, off the user-facing request path. CONCURRENTLY keeps the view readable during the refresh.

**Also in this change:** the empty-incremental short-circuit (Fix 4). An incremental sync that finds zero new rows now completes without promoting — no refresh, no cache bust, no notification email. Existing `vera_prod` data may have a backlog of empty promoted runs; demote them with the one-shot SQL below.

**Files:**
- `apps/web/prisma/migrations/20260515000000_add_livejob_materialized_view/migration.sql` — view + indexes
- `apps/web/lib/backfill/merge-view.ts` — read helpers rewritten to read from `LiveJob`
- `apps/web/lib/backfill/tick-worker.ts` — REFRESH call + empty-incremental short-circuit
- `DASHBOARD_DATA_FETCH_REVIEW.md`, `MULTI_RECIPIENT_CODE_REVIEW.md` — review writeups (not deployed, kept in repo for context)

**Verification done in dev:**
- OLD vs NEW row-by-row diff: zero discrepancies across `dedup`, `data_version`, `ar_membership`, `addressDupCount`, and `writeoffs` checks. Script at `/tmp/verify-livejob.sql` (also reproducible against prod by adapting the connection).
- `/api/jobs/aging` returns 127 jobs / $1,236,826.70 / 26 duplicate-address anomalies — identical to the old code path.
- Typecheck (`tsc --noEmit`) clean.
- All `/dashboard/*` pages return 200.
- **End-to-end backfill flow tested.** Simulated a complete backfill cycle: created a new `BackfillRun`, wrote a modified `RawRooflinkJob` row for an existing AR job (bumped balance from $52,155.79 → $99,999.99), marked the run `promoted=true`, ran `REFRESH MATERIALIZED VIEW CONCURRENTLY "LiveJob"`, and hit `/api/jobs/aging`. Result: `totalBalance` reflected the new value (delta exactly $47,844.20), job 296667 in the response carried the new balance, totalCount remained 127. New data flows end-to-end exactly as expected. Cleanup verified: after deleting the synthetic row and run + refresh, baseline restored to 127 jobs / $1,236,826.70.
- Bug found and fixed during verification: `excludeFromQb` was defined as `(payload->>'exclude_from_qb') = 'true'`, which returns NULL for missing fields. The defensive old logic treated missing-field rows as "not excluded" (include in AR). Fixed to `COALESCE(... = 'true', false)` so missing fields → false → row included. Without this, prod rows with missing `exclude_from_qb` would have been silently dropped from the dashboard.

**Production verification — results from the actual 2026-05-15 deploy:**

| Number | Pre-deploy (OLD JSONB read) | Post-deploy (LiveJob view) | Match? |
|---|---|---|---|
| Deduped jobs | 103,440 | 103,440 | ✅ |
| AR-eligible | 130 | 130 | ✅ |
| AR total balance | $1,278,629.33 | $1,278,629.33 | ✅ |
| Duplicate-address keys | 4,545 | 4,545 | ✅ |
| Rows in dup-address sets | 9,720 | 9,720 | ✅ |

`scripts/verify-livejob.sql` returned zero discrepancies across all 14 checks on vera_prod. Cleanup SQL demoted 5 existing empty-promoted incrementals. First post-deploy REFRESH cycle: 12 s. Public + protected dashboard routes responded as expected (200 for public, 307 redirect to /login for protected — auth middleware functioning correctly).

**What to watch in the first 24 h:**
- Backfill worker logs. If `[backfill] LiveJob refresh failed` ever appears, the cache will be stale until the next successful refresh — investigate immediately.
- Audit log for the next promote — confirm Fix 4 fires on empty incrementals (logged as `[backfill] run #N (...) completed with 0 new rows — skipping promote/refresh/notify`).
- Browser-level smoke once an authenticated session is available: dashboard filters + detail sheets + write-offs reconciliation should look identical to before deploy.

**Rollback path:** the change is self-contained. To revert:
1. Revert the merge-view.ts read helpers (single commit).
2. Revert the tick-worker promote() change (same commit).
3. `DROP MATERIALIZED VIEW "LiveJob";` — `RawRooflinkJob` is untouched and remains the source of truth.

No data loss in either direction.

---

### 2026-05-14 — Multi-recipient notifications + audited follow-up send

**`0cdedd0` — Two related features shipped together.**

*Multi-recipient notifications.* Every notification surface in the
scheduler — daily AR brief, weekly summary, monthly close, and both
data-sync sources (`rooflink_jobs`, `rooflink_lineitems`) — now accepts
up to six recipient emails instead of one. A new `EmailChipInput`
primitive in `@vera/ui` drives the UX (paste-splits on commas, Backspace
removes the last chip, invalid emails caught inline). Sync emails read
from `BackfillSchedule.recipients` rather than fanning out to every user
on the tenant, so the operator now controls who hears about a sync run.
Run-now is gated on a non-empty recipients list to prevent silent
no-email syncs; when the list is empty, `tick-worker` writes
`backfill.notification_skipped_no_recipients` to the audit log.

*Audited follow-up email send.* The "Draft email" button on
`/dashboard/follow-ups` now opens a compose modal with TO + CC chip
inputs, sends through Resend via a new audited route
`/api/follow-ups/send`, and writes a row to `AuditLog` per send. The old
`mailto:` fallback is retired.

**Schema migrations applied to prod:**

- `20260514120527_schedule_recipients_array` — `Schedule.recipient` →
  `Schedule.recipients TEXT[]`; `BackfillSchedule` gains
  `recipients TEXT[]`. Non-destructive: existing recipient values were
  preserved as single-element arrays.
- `20260514120845_sendlog_toemails_array` — `SendLog.toEmail` →
  `SendLog.toEmails TEXT[]`. Same non-destructive pattern.

Both Schedule and BackfillSchedule were empty in prod at deploy time, so
no rows needed backfilling. SendLog was also empty.

**Rollback:** `vercel rollback` to the prior production deployment
(`dpl_HJ1XhgoNZRUr2Gv6L7YvFBPFUQpg`), then reverse the schema by hand
against `vera_prod` (ADD old column → backfill from `recipients[1]` →
DROP new column). Inverse SQL kept in the commit message of the next
revert if needed.

### 2026-05-14 — Documentation revamp (no runtime change)

**`5bc354a` + `f499a83` — Docs-only.** Full revamp of the project's
documentation post-DB-cutover. 29 markdown files → 17 active + 10
historical. Every active doc reflects the current production topology
(GCP Cloud SQL, DB read path, PDF emails, Playwright safety guard).

New docs: `docs/SYNC_EMAIL.md`, `docs/GCP_DB_ADMIN.md`, `docs/BACKLOG.md`
(consolidated from three earlier backlogs). Historical plans moved to
`docs/_history/`. New `CLAUDE.md` rule #14: every prod deploy gets a
release-log entry — this commit is the first one to follow it.

No runtime behavior change. The deploy refreshes the Vercel build
artifact and propagates the docs to the canonical Git remote. Production
APIs / dashboards continue to behave exactly as before.

**Rollback:** `vercel rollback` to the prior production deployment if
something unexpected breaks; the prior deployment is functionally
identical anyway.

### 2026-05-14 — Database cutover day

A long day. Multiple shipments and one rolled-back attempt.

**`1995d41` — Post-sync PDF email on backfill completion.** The backfill
sync-complete email now carries a one-page PDF listing the touched
records, so operators see *which* records flowed through, not just the
count. The render is done in-process with `@react-pdf/renderer`; the PDF
is attached via Resend. Capped at 200 records per run; if a run touched
more, the PDF lists the top 200 by balance (jobs) or work-RCV (line
items). Full pipeline doc in [`SYNC_EMAIL.md`](SYNC_EMAIL.md).

**`083f6a8` — Push DB read path filtering into Postgres.** The earlier
DB cutover attempt failed because each cold dashboard request pulled the
full 120,300-row JSONB population (~200 MB) into Node before filtering
to the ~130 AR-eligible jobs. Across the public internet to Vercel, that
times out. The fix uses two SQL helpers — `getLiveARJobsWithContext` and
`getLiveJobsForWriteOffs` — that push the working-set filter and the
duplicate-address aggregation into Postgres via CTEs. Per-cold-request
transfer dropped to ~650 KB, a 320× reduction. Cold-start time dropped
from "function timed out" to ~1.5 s server + sub-second wire. Domain
transforms (heat score, anomalies, reconciliation) stay in TypeScript —
no SQL duplication. Full design rationale in [`DATA_MODEL.md`](DATA_MODEL.md).

**`083f6a8` (continued) — Playwright safety guard.** Tests' global-setup
file wipes 8 data tables before every run. Today that nuked ~120k
Rooflink job payloads in `vera_dev` because the runner was pointed at
the dev DB. Added a probe: if any `BackfillRun` has `promoted=true`,
Playwright refuses to start and points the operator at a dedicated test
DB. Override via `PLAYWRIGHT_ALLOW_PROD_DATA_WIPE=1` for the rare case
of intentionally wiping a dev DB. The data was recovered from `vera_prod`
within a few minutes; the guard is forever.

**`e88d6e3` — DB read path live (`USE_DB_DATA_SOURCE=1`).** Dashboards
now read from `vera_prod` at request time, not the build-time JSON
snapshot. Every promoted backfill makes new data visible automatically.
Also shipped in this merge:
- Skeleton loaders for every server-component route.
- Run-now bug fix — derives watermark from `BackfillRun.startedAt`
  rather than only `BackfillSchedule.lastSyncedAt`, so Run-now picks
  incremental mode even when no schedule row exists.
- Write-offs DB-path scope alignment (the JSON file was broadened on
  May 13; the DB path now matches: no AR-only filter, 2024+ install
  cutoff, scope = `all-estimates`).
- `vera_prod` provisioned on GCP Cloud SQL with a scoped `vera_app`
  role; Neon abandoned (quota exhausted).
- `docs/GCP_MIGRATION.md` runbook documenting the migration.

### 2026-05-13 — Write-offs broadened

**`49551d5` (PR #19) — Write-offs scope expanded.** The write-offs
dashboard now surfaces all estimates with an Amount Withheld discount on
or after a 2024 install date, not only those in the AR working set.
Result: 25 records ($139K) → 373 records ($2.26M). A Status filter
(Active AR / Paid off) was added so operators can drill into one or the
other.

**`071b655` — `.vercelignore` excludes `worktrees/`.** A 196 MB
`jobs_dedup.jsonl` inside a worktree was being uploaded with deploys,
hitting Vercel's 100 MB single-file limit. Fixed by excluding the
worktree path.

### 2026-05-12 — Backfill scheduling system

**`811d82e` — QStash-based backfill ticks + atomic promote.** The
backfill pipeline: a `BackfillSchedule` row drives a recurring run; each
run is a chain of QStash ticks that fetches one Rooflink page per tick;
on completion the run flips `promoted=true` and invalidates the
dashboard cache. Run-now ad-hoc triggers use the same machinery with
`scheduleId=null`. Cancellation is atomic and idempotent.

**`df70f25` — Write-offs dashboard.** New page at `/dashboard/write-offs`
listing every estimate with an `Amount Withheld` discount line item.
Reads from `apps/web/data/write-offs.json` at this point (DB path comes
on May 14).

**`569894a` — Customer column + install date.** Both columns added across
Aging, Milestones, Follow-ups, Write-offs. Install date formatted
US-style (MM/DD/YYYY) per UI convention.

### 2026-05-11 — Cron stabilization

**PR #13 — Scheduler natural-key + QStash migration.** Two compounding
bugs fixed in one PR. Scheduler was duplicating rows (every save
inserted a new `Schedule` row, accumulating 11 daily rows for tenant 1
by May 10) — fixed by enforcing `(tenantId, cadence)` as a DB unique
index, rewriting the API as `PUT/DELETE /api/schedules/[cadence]`, and
rebuilding the UI around three explicit states (Unscheduled / Scheduled /
Paused). Cron was unreliable on GitHub Actions (~5% delivery rate) —
migrated to Upstash QStash, which fires within seconds.

### 2026-05-08 — Foundational ship

**PR #5 — Foundational ship.** ~10 commits squashed: multi-tenant auth,
Postgres on Neon (at the time), AI briefing, real scheduling, exit
animations, mobile chip overflow fix, Playwright revival with JWT auth
helper. Most of what's on prod today.

**PR #4 — `fix(chat)`.** Customer-name surface bug + tighter `listJobs`
prompt.

### Earlier

See `git log` for everything prior to PR #4.

---

## Currently on `main` but not deployed

If a commit landed on `main` after the most recent successful production
deploy, list it here. Today: nothing pending — `main` and prod are in
sync as of 2026-05-14 16:53 IST.

---

## Versioning

We don't ship versioned releases (no SemVer tags, no GitHub releases).
The deployed `main` SHA *is* the version.

```bash
# Current prod SHA
vercel ls --prod | head -2

# Compare against local main
git rev-parse origin/main
```

If you need a stable reference for a demo or a customer touchpoint,
capture the SHA in your meeting notes.
