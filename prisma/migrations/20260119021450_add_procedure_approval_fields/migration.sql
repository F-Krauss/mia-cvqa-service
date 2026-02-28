-- AlterTable
ALTER TABLE "Procedure" ADD COLUMN     "procedureApprovalStatus" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN     "procedureApprovedAt" TIMESTAMP(3),
ADD COLUMN     "procedureApprovedBy" TEXT;
