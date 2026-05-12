-- AlterTable
ALTER TABLE "BackfillRun" ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'full',
ADD COLUMN     "syncedSince" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "BackfillSchedule" ADD COLUMN     "lastFullSyncAt" TIMESTAMP(3),
ADD COLUMN     "lastSyncedAt" TIMESTAMP(3);
