#!/usr/bin/env bash
#
# scripts/setup-worktree.sh
# Bootstrap a fresh git worktree with the gitignored-but-required files
# it needs to actually run. Then install deps and regen Prisma.
#
# Why this exists: a fresh `git worktree add` only checks out tracked
# files. The MVP needs `apps/web/.env.local` (gitignored), and the
# 196 MB `data/jobs_dedup.jsonl` (gitignored, only used by the local
# cold-start helper at `scripts/load-jsonl-into-local.mjs`) — without
# these, env-dependent commands fail. Doing it by hand is error-prone
# and we've lost time to it before.
#
# Usage:
#   scripts/setup-worktree.sh <worktree-path>
#
# Idempotent — re-running against an already-populated worktree just
# prints "skip" for the existing files and re-runs install/generate.

set -euo pipefail

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  echo "usage: $(basename "$0") <worktree-path>" >&2
  echo "" >&2
  echo "Bootstraps a git worktree by copying gitignored files (.env.local," >&2
  echo "data/*) from the canonical main repo, then runs pnpm install +" >&2
  echo "prisma generate." >&2
  exit 1
fi

if [ ! -d "$TARGET" ]; then
  echo "error: target does not exist: $TARGET" >&2
  echo "create the worktree first: git worktree add $TARGET <branch>" >&2
  exit 1
fi

TARGET=$(cd "$TARGET" && pwd)

# Resolve the canonical main repo from `git worktree list` — its first
# entry is always the main worktree. Works regardless of where this
# script is invoked from.
MAIN_REPO=$(git -C "$TARGET" worktree list | head -1 | awk '{print $1}')

if [ "$TARGET" = "$MAIN_REPO" ]; then
  echo "error: target IS the main repo." >&2
  echo "this script is for bootstrapping worktrees, not the main checkout." >&2
  exit 1
fi

copy_if_missing() {
  local src="$1" dst="$2"
  local rel_dst="${dst/#$TARGET\//}"
  if [ ! -f "$src" ]; then
    local rel_src="${src/#$MAIN_REPO\//}"
    echo "  warn: source missing, skipping $rel_dst (no $rel_src in main repo)"
    return
  fi
  if [ -f "$dst" ]; then
    echo "  skip (exists): $rel_dst"
    return
  fi
  mkdir -p "$(dirname "$dst")"
  cp "$src" "$dst"
  echo "  copied: $rel_dst"
}

# .env.local needs special handling. Skipping on "exists" silently is a
# footgun: if a previous run created a partial .env.local (e.g. an earlier
# Claude session that wrote one with only DATABASE_URL pointed at local
# Postgres, omitting GOOGLE_CLIENT_ID etc.), the worktree silently lacks
# Google OAuth, OpenAI, Resend, NewsAPI, AUTH_TRUST_HOST, NEXTAUTH_SECRET,
# DATABASE_URL_UNPOOLED — every feature that depends on those breaks.
#
# This helper does the right thing on every code path:
#   • fresh worktree (no .env.local)  → copy canonical verbatim
#   • existing .env.local matches canonical keys → leave alone, report ✓
#   • existing .env.local is MISSING canonical keys → emit a loud warning
#     with the exact key list and a one-line merge command
sync_env_local() {
  local src="$1" dst="$2"
  if [ ! -f "$src" ]; then
    echo "  warn: no .env.local in canonical — cannot bootstrap"
    return
  fi
  if [ ! -f "$dst" ]; then
    mkdir -p "$(dirname "$dst")"
    cp "$src" "$dst"
    echo "  copied .env.local from canonical (verbatim)"
    return
  fi
  # Both files exist — compare key sets.
  local src_keys dst_keys missing
  src_keys=$(grep -E "^[A-Z_][A-Z0-9_]*=" "$src" | cut -d= -f1 | sort -u)
  dst_keys=$(grep -E "^[A-Z_][A-Z0-9_]*=" "$dst" | cut -d= -f1 | sort -u)
  missing=$(comm -23 <(echo "$src_keys") <(echo "$dst_keys"))
  if [ -z "$missing" ]; then
    echo "  .env.local exists and has every canonical key ✓"
    return
  fi
  echo ""
  echo "  ⚠ .env.local exists but is MISSING $(echo "$missing" | wc -l | tr -d ' ') canonical key(s):"
  echo "$missing" | sed 's/^/      - /'
  echo ""
  echo "  To merge canonical's secrets into the existing .env.local without"
  echo "  losing your local DATABASE_URL override, run:"
  echo "      LOCAL_DB=\$(grep '^DATABASE_URL=' $dst)"
  echo "      cp $src $dst.new"
  echo "      sed -i.bak \"s|^DATABASE_URL=.*|\$LOCAL_DB|\" $dst.new"
  echo "      mv $dst.new $dst"
  echo ""
}

echo "Bootstrapping worktree:"
echo "  main:   $MAIN_REPO"
echo "  target: $TARGET"
echo ""
echo "→ Copying gitignored files"
sync_env_local    "$MAIN_REPO/apps/web/.env.local"   "$TARGET/apps/web/.env.local"
copy_if_missing   "$MAIN_REPO/data/jobs_dedup.jsonl" "$TARGET/data/jobs_dedup.jsonl"
# Note: `data/generated.json` was retired in the JSON-removal change. The
# app no longer reads bundled JSON — see docs/JSON_REMOVAL_PLAN.md.

echo ""
echo "→ Installing dependencies (pnpm install)"
(cd "$TARGET" && pnpm install 2>&1) | tail -3

echo ""
echo "→ Generating Prisma client"
(cd "$TARGET" && pnpm --filter @vera/web exec prisma generate 2>&1) | tail -3

echo ""
echo "Done — worktree ready at $TARGET"
echo "Next: cd $TARGET && pnpm --filter @vera/web dev --port <unused-port>"
