-- Document areas mapping (many-to-many)
CREATE TABLE "DocumentArea" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentArea_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DocumentArea_documentId_areaId_key" ON "DocumentArea"("documentId", "areaId");
CREATE INDEX "DocumentArea_areaId_idx" ON "DocumentArea"("areaId");

ALTER TABLE "DocumentArea" ADD CONSTRAINT "DocumentArea_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "DocumentFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentArea" ADD CONSTRAINT "DocumentArea_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE CASCADE ON UPDATE CASCADE;
