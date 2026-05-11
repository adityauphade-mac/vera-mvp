-- Migration: add AuditLog table.
--
-- Append-only activity stream — rows never get updated. The Prisma
-- client extension at lib/db.ts will auto-log mutations on auditable
-- models; non-DB events (auth, chat, cron sends) call recordAudit()
-- explicitly.
--
-- Purely additive: existing code that doesn't know about AuditLog
-- continues to work fine. Safe to apply to the shared Neon DB before
-- the application code rolls out.

CREATE TABLE "AuditLog" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "userId" INTEGER,
    "userEmail" TEXT,
    "category" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "summary" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- Hot path: list-by-tenant ordered by recency. Default sort of the
-- audit-log UI page.
CREATE INDEX "AuditLog_tenantId_createdAt_idx"
  ON "AuditLog"("tenantId", "createdAt");

-- Filter combo used by the UI's category + action dropdowns.
CREATE INDEX "AuditLog_tenantId_category_action_idx"
  ON "AuditLog"("tenantId", "category", "action");

-- "Show audit history for this specific Schedule row" — future deep
-- link from any entity to its history. Schema supports it today; UI
-- route is V2.
CREATE INDEX "AuditLog_tenantId_entityType_entityId_idx"
  ON "AuditLog"("tenantId", "entityType", "entityId");

ALTER TABLE "AuditLog"
  ADD CONSTRAINT "AuditLog_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
