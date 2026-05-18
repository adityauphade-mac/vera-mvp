#!/usr/bin/env bash
#
# Wrapper for `playwright test` that pins the suite to the `vera_test`
# Postgres DB on a non-default port (3001), so:
#   - A `pnpm dev` server at 3000 against `vera_dev` can coexist with
#     test runs.
#   - Playwright's webServer spawns `next start` on 3001 with the env
#     vars set below — vera_test as DB, USE_DB_DATA_SOURCE=1 so the DB
#     read path is exercised.
#
# Defaults can be overridden:
#   TEST_DATABASE_URL    — full Postgres URL (default: postgresql://$USER@localhost:5432/vera_test)
#   TEST_PORT            — port the test server listens on (default: 3001)
#
# Anything passed to this script is forwarded to `playwright test`,
# so `./scripts/test-e2e.sh tests/e2e/write-offs.spec.ts` works.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

export DATABASE_URL="${TEST_DATABASE_URL:-postgresql://${USER}@localhost:5432/vera_test}"
export USE_DB_DATA_SOURCE=1
export PLAYWRIGHT_TEST_DB=1
export PORT="${TEST_PORT:-3001}"

echo "[test-e2e] DATABASE_URL=$DATABASE_URL"
echo "[test-e2e] PORT=$PORT  USE_DB_DATA_SOURCE=$USE_DB_DATA_SOURCE"

# Build the app once before Playwright spins up `next start`. Without the
# build, `next start` errors with "Couldn't find a production build". The
# `prisma generate` step inside `next build` is environment-agnostic and
# uses whatever DATABASE_URL is exported — but our URL points at a real
# local DB so it works either way.
pnpm --filter @vera/web build

# Ensure the seed is loaded before tests run. global-setup also re-seeds
# per run, but doing it here too gives a clean failure mode if the seed
# file is missing on the developer's machine.
if [[ ! -f tests/fixtures/vera_test.sql ]]; then
  echo "[test-e2e] generating seed file (missing)..."
  pnpm exec tsx scripts/generate-vera-test-seed.ts
fi

exec pnpm exec playwright test "$@"
