-- AlterTable
ALTER TABLE "DocumentFile" ADD COLUMN     "aiProcessedAt" TIMESTAMP(3),
ADD COLUMN     "aiProcessingStatus" TEXT,
ADD COLUMN     "aiSummary" TEXT,
ADD COLUMN     "aiTags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "DocumentFile_aiProcessingStatus_idx" ON "DocumentFile"("aiProcessingStatus");
