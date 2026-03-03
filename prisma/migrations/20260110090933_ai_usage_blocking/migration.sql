-- CreateTable
CREATE TABLE "AiUsageStat" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "tokens" INTEGER NOT NULL DEFAULT 0,
    "lastQueryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiUsageStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUserBlock" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "start" TIMESTAMP(3) NOT NULL,
    "end" TIMESTAMP(3),
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiUserBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiUsageStat_organizationId_date_idx" ON "AiUsageStat"("organizationId", "date");

-- CreateIndex
CREATE INDEX "AiUsageStat_userId_organizationId_idx" ON "AiUsageStat"("userId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AiUsageStat_userId_date_key" ON "AiUsageStat"("userId", "date");

-- CreateIndex
CREATE INDEX "AiUserBlock_userId_start_end_idx" ON "AiUserBlock"("userId", "start", "end");

-- CreateIndex
CREATE INDEX "AiUserBlock_organizationId_start_end_idx" ON "AiUserBlock"("organizationId", "start", "end");

-- AddForeignKey
ALTER TABLE "AiUsageStat" ADD CONSTRAINT "AiUsageStat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsageStat" ADD CONSTRAINT "AiUsageStat_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUserBlock" ADD CONSTRAINT "AiUserBlock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUserBlock" ADD CONSTRAINT "AiUserBlock_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
