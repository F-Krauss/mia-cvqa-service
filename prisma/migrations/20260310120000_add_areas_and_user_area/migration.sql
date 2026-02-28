-- Create Area table
CREATE TABLE "Area" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Area_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Area_organizationId_idx" ON "Area"("organizationId");

ALTER TABLE "Area" ADD CONSTRAINT "Area_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Recreate UserArea table to use Area relation instead of Plant
DROP TABLE IF EXISTS "UserArea";

CREATE TABLE "UserArea" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserArea_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserArea_userId_areaId_key" ON "UserArea"("userId", "areaId");
CREATE INDEX "UserArea_userId_idx" ON "UserArea"("userId");
CREATE INDEX "UserArea_areaId_idx" ON "UserArea"("areaId");

ALTER TABLE "UserArea" ADD CONSTRAINT "UserArea_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserArea" ADD CONSTRAINT "UserArea_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE CASCADE ON UPDATE CASCADE;
