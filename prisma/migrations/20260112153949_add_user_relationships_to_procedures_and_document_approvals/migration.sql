/*
  Warnings:

  - You are about to drop the column `responsible` on the `Procedure` table. All the data in the column will be lost.
  - You are about to drop the column `reviewer` on the `Procedure` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Procedure" DROP COLUMN "responsible",
DROP COLUMN "reviewer",
ADD COLUMN     "responsibleId" TEXT,
ADD COLUMN     "reviewerId" TEXT;

-- CreateTable
CREATE TABLE "DocumentApproval" (
    "id" TEXT NOT NULL,
    "procedureId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "responsibleId" TEXT,
    "documentVersionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "approvalDate" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "notifyEmail" BOOLEAN NOT NULL DEFAULT false,
    "notifyWhatsapp" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentApproval_procedureId_idx" ON "DocumentApproval"("procedureId");

-- CreateIndex
CREATE INDEX "DocumentApproval_reviewerId_idx" ON "DocumentApproval"("reviewerId");

-- CreateIndex
CREATE INDEX "DocumentApproval_responsibleId_idx" ON "DocumentApproval"("responsibleId");

-- CreateIndex
CREATE INDEX "DocumentApproval_status_idx" ON "DocumentApproval"("status");

-- CreateIndex
CREATE INDEX "Procedure_reviewerId_idx" ON "Procedure"("reviewerId");

-- CreateIndex
CREATE INDEX "Procedure_responsibleId_idx" ON "Procedure"("responsibleId");

-- AddForeignKey
ALTER TABLE "Procedure" ADD CONSTRAINT "Procedure_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Procedure" ADD CONSTRAINT "Procedure_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentApproval" ADD CONSTRAINT "DocumentApproval_procedureId_fkey" FOREIGN KEY ("procedureId") REFERENCES "Procedure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentApproval" ADD CONSTRAINT "DocumentApproval_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentApproval" ADD CONSTRAINT "DocumentApproval_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
