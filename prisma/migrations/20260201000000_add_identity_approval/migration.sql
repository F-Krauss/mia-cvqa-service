ALTER TABLE "User"
ADD COLUMN     "identityApproved" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "identityApprovedAt" TIMESTAMP(3);
