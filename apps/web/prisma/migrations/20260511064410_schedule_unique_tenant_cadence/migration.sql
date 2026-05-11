-- Migration: enforce one Schedule row per (tenantId, cadence).
--
-- Before this change, POST /api/schedules created a fresh row on every
-- submit. Operators changing the recipient of "Daily AR brief" left the
-- old row enabled, and the cron worker dutifully fired all of them. The
-- May 9–10 weekend burst (8 daily emails per dispatch tick) was caused
-- by 8 accumulated rows for the same tenant+cadence.
--
-- Steps run inside a single transaction (Prisma's default for .sql
-- migrations). If dedupe misses anything, the unique-index creation at
-- the end fails and the whole migration rolls back.
--
-- 1. Dedupe: keep newest row per (tenantId, cadence), delete the rest.
--    SendLog.scheduleId is nullable, so the FK from historical send rows
--    survives the parent delete (Prisma's default action is SetNull).

DELETE FROM "Schedule"
WHERE id NOT IN (
  SELECT DISTINCT ON ("tenantId", cadence) id
  FROM "Schedule"
  ORDER BY "tenantId", cadence, "createdAt" DESC, id DESC
);

-- 2. Add updatedAt. Default to now() so existing rows have a sane value;
--    Prisma's @updatedAt will keep it fresh on subsequent writes.

ALTER TABLE "Schedule"
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 3. Enforce the natural key at the DB. The app-level upsert is the first
--    line of defense; this is the safety net so a future buggy migration
--    or hand-edited insert can never reintroduce duplicates silently.

CREATE UNIQUE INDEX "Schedule_tenantId_cadence_key"
  ON "Schedule"("tenantId", cadence);
