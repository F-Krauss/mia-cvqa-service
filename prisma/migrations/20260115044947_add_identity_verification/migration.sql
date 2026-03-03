-- AlterTable
ALTER TABLE "User" ADD COLUMN     "identityCheckId" TEXT,
ADD COLUMN     "identityDocumentImage" TEXT,
ADD COLUMN     "identityProvider" TEXT,
ADD COLUMN     "identitySelfieImage" TEXT,
ADD COLUMN     "identityVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "identityVerifiedAt" TIMESTAMP(3);
