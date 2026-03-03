-- AlterTable
ALTER TABLE "DocumentApproval" ADD COLUMN     "documentId" TEXT;

-- CreateIndex
CREATE INDEX "DocumentApproval_documentId_idx" ON "DocumentApproval"("documentId");

-- AddForeignKey
ALTER TABLE "DocumentApproval" ADD CONSTRAINT "DocumentApproval_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ProcedureDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
