-- CreateTable
CREATE TABLE "PieceOrder" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "plantId" TEXT,
    "processId" TEXT,
    "subprocessId" TEXT,
    "machineId" TEXT,
    "pieceName" TEXT NOT NULL,
    "partNumber" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unit" TEXT,
    "supplier" TEXT,
    "requestedBy" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedAt" TIMESTAMP(3),
    "orderedAt" TIMESTAMP(3),
    "arrivedAt" TIMESTAMP(3),
    "installedAt" TIMESTAMP(3),
    "trackingReference" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PieceOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PieceOrder_workOrderId_idx" ON "PieceOrder"("workOrderId");

-- CreateIndex
CREATE INDEX "PieceOrder_status_idx" ON "PieceOrder"("status");

-- CreateIndex
CREATE INDEX "PieceOrder_plantId_idx" ON "PieceOrder"("plantId");

-- CreateIndex
CREATE INDEX "PieceOrder_processId_idx" ON "PieceOrder"("processId");

-- CreateIndex
CREATE INDEX "PieceOrder_subprocessId_idx" ON "PieceOrder"("subprocessId");

-- CreateIndex
CREATE INDEX "PieceOrder_machineId_idx" ON "PieceOrder"("machineId");

-- AddForeignKey
ALTER TABLE "PieceOrder" ADD CONSTRAINT "PieceOrder_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PieceOrder" ADD CONSTRAINT "PieceOrder_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PieceOrder" ADD CONSTRAINT "PieceOrder_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PieceOrder" ADD CONSTRAINT "PieceOrder_subprocessId_fkey" FOREIGN KEY ("subprocessId") REFERENCES "Subprocess"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PieceOrder" ADD CONSTRAINT "PieceOrder_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
