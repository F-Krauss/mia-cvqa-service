-- AlterTable
ALTER TABLE "WorkOrder"
ADD COLUMN "troubleshootingStartedAt" TIMESTAMP(3),
ADD COLUMN "troubleshootingEndedAt" TIMESTAMP(3),
ADD COLUMN "troubleshootingDurationSeconds" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "technicalRepairStartedAt" TIMESTAMP(3),
ADD COLUMN "technicalRepairEndedAt" TIMESTAMP(3),
ADD COLUMN "technicalRepairDurationSeconds" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "partsWaitStartedAt" TIMESTAMP(3),
ADD COLUMN "partsWaitEndedAt" TIMESTAMP(3),
ADD COLUMN "partsWaitDurationSeconds" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "partsReplacementStartedAt" TIMESTAMP(3),
ADD COLUMN "partsReplacementEndedAt" TIMESTAMP(3),
ADD COLUMN "partsReplacementDurationSeconds" INTEGER NOT NULL DEFAULT 0;
