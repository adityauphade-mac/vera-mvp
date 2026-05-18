#!/usr/bin/env bash
#
# Provision the local `vera_test` Postgres DB used by the Playwright suite.
#
# Idempotent. Safe to re-run.
#
# What it does:
#   1. Verifies `vera_test` exists on localhost. (Creates it if missing.)
#   2. Runs `prisma migrate deploy` against it so the schema matches
#      `vera_dev` / `vera_prod`.
#   3. Loads the checked-in seed from `tests/fixtures/vera_test.sql`.
#   4. Refreshes the `LiveJob` materialized view non-concurrently so the
#      seed is visible to read-path code.
#
# Step 3 + 4 are skipped if the seed file doesn't exist yet — the generator
# at `scripts/generate-vera-test-seed.ts` produces it.
#
# Usage:
#   ./scripts/setup-vera-test.sh           # full provision + seed
#   ./scripts/setup-vera-test.sh --schema  # schema only, skip seed
#
# Hard safety: this script targets `localhost` only and the database name
# `vera_test`. It will NEVER touch `vera_dev`, `vera_prod`, or any remote
# host. The Playwright global-setup enforces the same invariants at
# test-run time.

set -euo pipefail

DB_HOST="localhost"
DB_NAME="vera_test"
# Prisma's libpq is strict — it requires an explicit user in the URL, even
# when the OS-user → PG-user mapping would work via socket peer auth. psql
# is happy without it but Prisma errors with P1010. Default to $USER.
DB_USER="${PGUSER:-$USER}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SEED_FILE="$REPO_ROOT/tests/fixtures/vera_test.sql"

SCHEMA_ONLY=0
if [[ "${1:-}" == "--schema" ]]; then
  SCHEMA_ONLY=1
fi

echo "[setup-vera-test] target: $DB_HOST/$DB_NAME"

# ─────────────────────────────────────────────────────────────────────────
# 1. Ensure the DB exists.
# ─────────────────────────────────────────────────────────────────────────
if ! psql -h "$DB_HOST" -lqtA | cut -d'|' -f1 | grep -qx "$DB_NAME"; then
  echo "[setup-vera-test] creating database $DB_NAME"
  createdb -h "$DB_HOST" "$DB_NAME"
else
  echo "[setup-vera-test] database $DB_NAME already exists"
fi

# ─────────────────────────────────────────────────────────────────────────
# 2. Apply migrations.
# ─────────────────────────────────────────────────────────────────────────
echo "[setup-vera-test] applying migrations"
(
  cd "$REPO_ROOT/apps/web"
  DATABASE_URL="postgresql://$DB_USER@$DB_HOST/$DB_NAME" \
    pnpm exec prisma migrate deploy
)

# ─────────────────────────────────────────────────────────────────────────
# 3. Load the seed (skipped on --schema).
# ─────────────────────────────────────────────────────────────────────────
if [[ $SCHEMA_ONLY -eq 1 ]]; then
  echo "[setup-vera-test] --schema mode, skipping seed"
  exit 0
fi

if [[ ! -f "$SEED_FILE" ]]; then
  echo "[setup-vera-test] no seed file at $SEED_FILE"
  echo "                  run: pnpm exec tsx scripts/generate-vera-test-seed.ts"
  exit 0
fi

echo "[setup-vera-test] loading seed: $SEED_FILE"
psql -h "$DB_HOST" -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$SEED_FILE" > /dev/null

# ─────────────────────────────────────────────────────────────────────────
# 4. Refresh LiveJob so reads see the seeded jobs.
#    Non-concurrent refresh (we're not contending with readers).
# ─────────────────────────────────────────────────────────────────────────
echo "[setup-vera-test] refreshing LiveJob materialized view"
psql -h "$DB_HOST" -d "$DB_NAME" -c 'REFRESH MATERIALIZED VIEW "LiveJob";' > /dev/null

echo "[setup-vera-test] done"
psql -h "$DB_HOST" -d "$DB_NAME" -tAc "
SELECT 'Tenant', count(*) FROM \"Tenant\"
UNION ALL SELECT 'User', count(*) FROM \"User\"
UNION ALL SELECT 'BackfillRun (promoted)', count(*) FROM \"BackfillRun\" WHERE promoted=true
UNION ALL SELECT 'RawRooflinkJob', count(*) FROM \"RawRooflinkJob\"
UNION ALL SELECT 'RawRooflinkLineItems', count(*) FROM \"RawRooflinkLineItems\"
UNION ALL SELECT 'LiveJob (deduped)', count(*) FROM \"LiveJob\";
" | column -t -s '|'
