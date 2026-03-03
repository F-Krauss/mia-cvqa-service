CREATE TYPE "OrgEmailChannelType" AS ENUM ('google_oauth', 'microsoft_oauth', 'smtp');
CREATE TYPE "OrgEmailChannelStatus" AS ENUM ('pending', 'verified', 'active', 'disabled');

CREATE TABLE "OrgEmailChannel" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "OrgEmailChannelType" NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "replyTo" TEXT,
    "smtpHost" TEXT,
    "smtpPort" INTEGER,
    "smtpSecure" BOOLEAN,
    "smtpUsername" TEXT,
    "smtpEncryptedPassword" TEXT,
    "oauthEncryptedTokens" TEXT,
    "status" "OrgEmailChannelStatus" NOT NULL DEFAULT 'pending',
    "lastTestedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgEmailChannel_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrgEmailChannel_organizationId_idx" ON "OrgEmailChannel"("organizationId");
CREATE INDEX "OrgEmailChannel_status_idx" ON "OrgEmailChannel"("status");
CREATE INDEX "OrgEmailChannel_type_idx" ON "OrgEmailChannel"("type");

ALTER TABLE "OrgEmailChannel" ADD CONSTRAINT "OrgEmailChannel_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
