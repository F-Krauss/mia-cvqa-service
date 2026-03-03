ALTER TABLE "OrganizationSetting"
ADD COLUMN "smtpHost" TEXT,
ADD COLUMN "smtpPort" INTEGER,
ADD COLUMN "smtpUser" TEXT,
ADD COLUMN "smtpPassword" TEXT,
ADD COLUMN "smtpSecure" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "smtpFromEmail" TEXT;
