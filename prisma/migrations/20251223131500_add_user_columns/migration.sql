-- Adding missing user columns to align DB with Prisma schema
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "accessLevel" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "employeeId" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "plantScope" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "position" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "processScope" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "subprocessScope" TEXT;
