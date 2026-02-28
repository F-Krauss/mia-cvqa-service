-- CreateTable
CREATE TABLE "ProcedureDocumentReference" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "refType" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcedureDocumentReference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProcedureDocumentReference_versionId_idx" ON "ProcedureDocumentReference"("versionId");

-- CreateIndex
CREATE INDEX "ProcedureDocumentReference_refType_code_idx" ON "ProcedureDocumentReference"("refType", "code");

-- AddForeignKey
ALTER TABLE "ProcedureDocumentReference" ADD CONSTRAINT "ProcedureDocumentReference_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ProcedureDocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
