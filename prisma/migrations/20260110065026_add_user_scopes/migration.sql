-- CreateEnum
CREATE TYPE "ScopeType" AS ENUM ('ORGANIZATION', 'PLANT', 'PROCESS');

-- CreateTable
CREATE TABLE "UserScope" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scopeType" "ScopeType" NOT NULL,
    "entityId" TEXT,
    "entityName" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedBy" TEXT,

    CONSTRAINT "UserScope_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserScope_userId_idx" ON "UserScope"("userId");

-- CreateIndex
CREATE INDEX "UserScope_scopeType_idx" ON "UserScope"("scopeType");

-- AddForeignKey
ALTER TABLE "UserScope" ADD CONSTRAINT "UserScope_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
