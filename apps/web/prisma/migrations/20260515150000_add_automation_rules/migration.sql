-- CreateTable
CREATE TABLE "AutomationRule" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "thresholdDays" INTEGER,
    "recipientMode" TEXT NOT NULL,
    "recipientEmail" TEXT,
    "subjectTemplate" TEXT NOT NULL,
    "bodyTemplate" TEXT NOT NULL,
    "dailySendCap" INTEGER NOT NULL DEFAULT 25,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastEvaluatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" INTEGER,

    CONSTRAINT "AutomationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleEvaluationState" (
    "id" SERIAL NOT NULL,
    "ruleId" INTEGER NOT NULL,
    "jobId" INTEGER NOT NULL,
    "lastMetricValue" DOUBLE PRECISION,
    "wasAboveThreshold" BOOLEAN NOT NULL DEFAULT false,
    "streakStartedAt" TIMESTAMP(3),
    "lastFiredAt" TIMESTAMP(3),
    "lastEvaluatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RuleEvaluationState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingRuleSend" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "ruleId" INTEGER NOT NULL,
    "jobId" INTEGER NOT NULL,
    "triggerSnapshot" JSONB NOT NULL,
    "proposedRecipient" TEXT,
    "proposedSubject" TEXT NOT NULL,
    "proposedBody" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewedById" INTEGER,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "sendLogId" INTEGER,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingRuleSend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutomationRule_tenantId_enabled_idx" ON "AutomationRule"("tenantId", "enabled");

-- CreateIndex
CREATE INDEX "RuleEvaluationState_ruleId_idx" ON "RuleEvaluationState"("ruleId");

-- CreateIndex
CREATE UNIQUE INDEX "RuleEvaluationState_ruleId_jobId_key" ON "RuleEvaluationState"("ruleId", "jobId");

-- CreateIndex
CREATE INDEX "PendingRuleSend_tenantId_status_createdAt_idx" ON "PendingRuleSend"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PendingRuleSend_ruleId_idx" ON "PendingRuleSend"("ruleId");

-- AddForeignKey
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleEvaluationState" ADD CONSTRAINT "RuleEvaluationState_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AutomationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingRuleSend" ADD CONSTRAINT "PendingRuleSend_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingRuleSend" ADD CONSTRAINT "PendingRuleSend_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AutomationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

