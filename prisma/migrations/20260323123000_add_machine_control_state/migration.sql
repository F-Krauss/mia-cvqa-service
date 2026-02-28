-- AlterTable
ALTER TABLE "Machine"
ADD COLUMN "controlState" TEXT NOT NULL DEFAULT 'enabled',
ADD COLUMN "controlReason" TEXT,
ADD COLUMN "controlUpdatedAt" TIMESTAMP(3),
ADD COLUMN "controlSourceWorkOrderId" TEXT;

-- CreateIndex
CREATE INDEX "Machine_controlState_idx" ON "Machine"("controlState");
