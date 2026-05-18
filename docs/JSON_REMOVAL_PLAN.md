# JSON-removal plan

> Status: **planned, not started.** Tracking PR: TBD.
> Owner: TBD.
> Target: next PR after the 2026-05-18 watermark fix lands.

## Why

Today the app has two read paths gated by `USE_DB_DATA_SOURCE`:

- **JSON path** — reads `apps/web/data/generated.json` (~245 KB) and `apps/web/data/write-offs.json` (~1.15 MB), bundled at build time from JSONL exports.
- **DB path** — reads live from Postgres (`vera_prod`) via the `LiveJob` materialized view + `RawRooflinkLineItems`.

Production has run on the DB path since 2026-05-14 (`USE_DB_DATA_SOURCE=1` in Vercel prod). The JSON files are dormant — imported at module scope (so they live in the JS bundle even when unused), shipped on every deploy, and kept "for emergency rollback." Rollback hasn't been exercised in months and would now diverge significantly from prod state. They've also been a source of confusion: they sit dirty in `git status` after dev preprocessing runs and create ambiguity about what's actually live.

Two adjacent surfaces follow the same pattern:

- A backfill fallback at [`apps/web/lib/backfill/rooflink.ts`](../apps/web/lib/backfill/rooflink.ts) — `loadEstimatesFromJsonl()` reads the 196 MB `data/jobs_dedup.jsonl` when no `rooflink_jobs` is promoted yet. Production has had a promoted run since 2026-05-13, so this branch is unreachable at runtime.
- The Playwright test suite — `tests/fixtures/generated.fixture.json` is a deterministic snapshot the JSON path reads when tests run.

This PR removes all three.

## Goals

- **One** read path: DB only.
- **One** backfill seeding path: live Rooflink (`RL_KEY`-gated), no JSONL fallback.
- Tests run against a dedicated `vera_test` Postgres DB, seeded from a checked-in SQL fixture.
- The Vercel build no longer carries the dormant JSON files.
- `USE_DB_DATA_SOURCE` removed from the environment (dead flag).

## Non-goals (out of scope)

- Rewriting domain transforms (`toARJob`, `toWriteOffRecord`, heat score, anomalies) — they continue to take the same shape.
- Changing the dashboard cache strategy — per-instance cache keyed on `(jobs-version, lineitems-version)` stays.
- Touching production data or schema.
- Building a CI for `vera_test`. Local dev only for v1; CI strategy can be a follow-up.

## Inventory of concrete changes

### Read path (~30 min)

| File | Change |
|---|---|
| [`apps/web/lib/data.ts`](../apps/web/lib/data.ts) | Delete the JSON branch + the dispatcher. Inline `getDataForCurrentSession` to call the DB reader directly. |
| [`apps/web/lib/write-offs-data.ts`](../apps/web/lib/write-offs-data.ts) | Delete `getWriteOffsFromJson()` + `jsonCache` + `import writeOffsJson` (line 10) + the `isDbPathEnabled()` check (line 172). |
| `apps/web/data/generated.json` | Delete. |
| `apps/web/data/write-offs.json` | Delete. |
| `apps/web/data/` (folder) | Delete entirely if empty after the file removals. |
| Vercel prod env | Remove `USE_DB_DATA_SOURCE` (after code stops reading it). |
| `.env.prod` | Remove the same line. |

### Backfill JSONL fallback (~20 min)

| File | Change |
|---|---|
| [`apps/web/lib/backfill/rooflink.ts`](../apps/web/lib/backfill/rooflink.ts) | Delete `loadEstimatesFromJsonl()`, the `cachedJsonlEstimates` module-scope cache, and the fallback branch in `loadEstimatesWithTimestamps()`. The "no promoted version found" case becomes a hard throw with a clearer message (operator must run a `rooflink_jobs` full sync first). |
| `data/jobs_dedup.jsonl` | Stays on developer machines (gitignored, vercelignored). Still useful for cold-starting a fresh `vera_dev` via `scripts/load-jsonl-into-local.mjs`. |
| `.vercelignore` | The `data/jobs_dedup.jsonl` line stays — defense-in-depth against accidental upload. |

### Tests — the big piece (~half-day)

**Strategy: dedicated `vera_test` Postgres DB**, seeded once per spec run from a checked-in SQL fixture. Real query path, real DB engine, no per-spec seeding cost beyond the initial wipe + load.

| Task | Notes |
|---|---|
| Provision `vera_test` locally | `CREATE DATABASE vera_test;` on the same local Postgres that hosts `vera_dev`. Same role (`vera_app`) for parity. |
| Generate seed SQL | One-off conversion script: read `tests/fixtures/generated.fixture.json` + `apps/web/data/write-offs.json`, emit `tests/fixtures/vera_test.sql` with `INSERT`s for `BackfillRun`, `RawRooflinkJob`, `RawRooflinkLineItems`, `LiveJob`-equivalent rows. Plus a synthetic `promoted=true` BackfillRun for the snapshot. |
| Playwright `global-setup` rewrite | Two modes: `PLAYWRIGHT_TEST_DB=1` + `DATABASE_URL` pointing at `vera_test` → wipe + load `vera_test.sql`. Default mode → fail fast with a message explaining how to start the test DB. |
| Delete `tests/e2e/dashboard-db-source.spec.ts` | Its sole purpose is to assert the JSON path and DB path return the same data. Obsolete when there's only one path. |
| Keep all other specs | Their assertions are already against DB-derived state when run with `USE_DB_DATA_SOURCE=1`. Seed SQL just needs to produce the same numeric outputs they assert. |
| Rewrite "Testing" section in `CLAUDE.md` | Drop "fixture JSON" language. Describe the `vera_test` DB flow + the `PLAYWRIGHT_TEST_DB=1` env. |
| Update the Playwright DB-wipe guard | The current guard refuses to run when `promoted=true` BackfillRun rows exist. `vera_test` has a synthetic promoted row by design. Add an exception via the `PLAYWRIGHT_TEST_DB=1` flag. |

**Decision: how to generate the seed SQL?** Two options:

- **(i)** Hand-author a minimal SQL fixture — easier to read, harder to keep aligned with test expectations as specs evolve.
- **(ii)** Programmatically convert `tests/fixtures/generated.fixture.json` (+ `write-offs.json`) to SQL — preserves current coverage to the row, slightly more script work upfront.

Recommend **(ii)**. The conversion script is ~50 lines of Node and lives at `scripts/generate-vera-test-seed.ts`; checked-in `tests/fixtures/vera_test.sql` is the human-readable artifact.

### Scripts cleanup (~1 hour)

| Script | Action | Why |
|---|---|---|
| `scripts/preprocess.ts` | **Delete.** | Generated `generated.json` from JSONL. Obsolete. |
| `scripts/fetch-write-offs.ts` | **Delete.** | Pre-DB-cutover seeder, superseded by `regen-write-offs-from-db.ts`. |
| `scripts/regen-write-offs-from-db.ts` | **Keep.** | Useful for one-shot re-emit (e.g. for an external consumer). No longer auto-run anywhere. |
| `scripts/test-cheap-sql-via-jsonl.mjs` | **Review then likely delete.** | Diagnostic from the DB-cutover work; unlikely to be needed again. |
| `scripts/test-cheap-sql-local-pg.mjs` | **Review then likely delete.** | Same. |
| `scripts/load-jsonl-into-local.mjs` | **Keep.** | Still useful for cold-starting `vera_dev` from the canonical JSONL. |
| `scripts/setup-worktree.sh` | **Update.** | Drop the `generated.json` + `write-offs.json` copy steps. Keep the `.env.local` + JSONL copy steps. |
| `scripts/verify-data.ts` | **Review.** | Diagnostic; either refresh for DB-only or delete. |
| `scripts/generate-vera-test-seed.ts` (new) | **Create.** | Per the test strategy above. |

### Docs (~30 min)

13 files reference `USE_DB_DATA_SOURCE`:

**Rewrite the dual-path passages:**
- [`CLAUDE.md`](../CLAUDE.md) — "Project context", "Testing", env-vars table
- [`docs/ARCHITECTURE.md`](ARCHITECTURE.md)
- [`docs/DATA_MODEL.md`](DATA_MODEL.md)
- [`docs/ONBOARDING.md`](ONBOARDING.md)
- [`docs/OPERATIONS.md`](OPERATIONS.md)
- [`docs/INFRASTRUCTURE.md`](INFRASTRUCTURE.md)
- [`docs/BACKLOG.md`](BACKLOG.md) — remove "JSON-removal" item if listed (this PR closes it)

**Add a one-line "retired" trailer:**
- `docs/_history/DATA_SOURCE_MIGRATION.md`
- `docs/_history/PHASE_A_LOCAL_CUTOVER_PLAN.md`

**Update top-of-file or no change:**
- `docs/RELEASE.md` — one entry for this PR; "Currently in production" section drops the `USE_DB_DATA_SOURCE=1` line.
- `docs/GCP_MIGRATION.md` — one-line update at top.
- `docs/TROUBLESHOOTING_HISTORY.md` — historical record, leave as-is.

## Sequenced PR steps

Single PR with multiple commits, in this order so that each commit leaves the repo green:

1. **`test(scaffold): vera_test DB + seed SQL + Playwright wiring`** — get tests running on the new DB *before* changing any production code. No app code touched. Tests pass under both paths because `USE_DB_DATA_SOURCE` is still respected.
2. **`feat(read-path): drop JSON dispatcher, DB-only reads`** — `lib/data.ts` + `lib/write-offs-data.ts`. Tests stay green against `vera_test`.
3. **`chore(data): delete dormant bundled JSON files`** — `apps/web/data/generated.json` + `write-offs.json`.
4. **`feat(backfill): drop JSONL fallback from rooflink.ts`** — narrows the seeding contract to "live Rooflink only."
5. **`chore(scripts): remove preprocess + fetch-write-offs + dead diagnostics`** — bundled script deletions.
6. **`docs: rewrite dual-path passages as single-path`** — the doc sweep.
7. **`chore(env): remove USE_DB_DATA_SOURCE from Vercel + .env.prod`** — last, after the deploy of step 6 stops reading the flag.

Step 7 is the only step that's a separate-from-PR operation (env edit + redeploy). Run it as the final action on the same day the PR merges.

## Open questions

- **CI for `vera_test`.** Local dev uses `localhost:5432/vera_test`. CI options: a Postgres service container, a hosted ephemeral DB (Neon branch, etc.), or skipping data-dependent specs in CI for now and running them locally only. Decide before starting step 1; affects how `PLAYWRIGHT_TEST_DB=1` is wired.
- **Seed SQL drift.** When test fixtures need new rows (a new heat-band edge case, etc.), the regen flow is: edit the source fixture JSON (or the generator script), re-run `scripts/generate-vera-test-seed.ts`, check in the updated `vera_test.sql`. Same workflow as today's `tests/fixtures/generated.fixture.json` updates.
- **Worktree onboarding.** `scripts/setup-worktree.sh` currently copies three files into new worktrees (`.env.local`, `jobs_dedup.jsonl`, `generated.json`). After this PR, only the first two are needed.

## Rollback considerations

- The PR is reversible via `git revert` of the merge commit — no schema changes, no DB-state changes.
- Re-adding `USE_DB_DATA_SOURCE=1` to Vercel after the revert restores the dual-path behavior; the JSON files come back via revert too.
- The biggest reversibility cost is the deleted scripts. If `preprocess.ts` turns out to still be needed for some workflow not captured here, recovery is `git show <sha>:scripts/preprocess.ts > scripts/preprocess.ts`.
- The intentional ordering (env removal **last**) means if any step from 1-6 introduces an issue post-deploy, the flag is still in place and can be flipped to fall back to JSON path — *but only if the JSON files haven't been deleted yet*. So in practice, the rollback boundary is step 3. After step 3 lands, full revert is the only path.

## Effort estimate

| Block | Effort |
|---|---|
| Test scaffolding (DB + seed + Playwright wiring) | ~3-4 h |
| Read-path collapse | ~30 min |
| Backfill JSONL fallback removal | ~20 min |
| Scripts cleanup | ~1 h |
| Docs sweep | ~30 min |
| Env cleanup + redeploy | ~15 min |
| Buffer for surprises | ~2 h |
| **Total** | **~1 working day** |
