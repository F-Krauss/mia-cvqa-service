-- AlterTable
ALTER TABLE "DocumentFile"
ADD COLUMN "aiDocType" TEXT,
ADD COLUMN "aiSafetyInstructions" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "DocumentFile_category_aiDocType_idx" ON "DocumentFile"("category", "aiDocType");
