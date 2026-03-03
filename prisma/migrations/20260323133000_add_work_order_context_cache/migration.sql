-- CreateTable
CREATE TABLE IF NOT EXISTS "WorkOrderContextCache" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "organizationId" TEXT,
    "cachedWorkInstructions" JSONB,
    "cachedSimilarWorkOrders" JSONB,
    "cachedDocuments" JSONB,
    "cachedManualInsights" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cachedManualSources" JSONB,
    "cachedReferenceDictionary" TEXT,
    "relevanceQuery" TEXT,
    "queryEmbedding" JSONB,
    "similarCachedQueries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastEnrichedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "preloadCompleted" BOOLEAN NOT NULL DEFAULT false,
    "preloadAttempts" INTEGER NOT NULL DEFAULT 0,
    "expansionQueries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dynamicallyAddedDocuments" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dynamicallyAddedInstructions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkOrderContextCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "WorkOrderContextCache_workOrderId_key" ON "WorkOrderContextCache"("workOrderId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WorkOrderContextCache_workOrderId_idx" ON "WorkOrderContextCache"("workOrderId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WorkOrderContextCache_organizationId_idx" ON "WorkOrderContextCache"("organizationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WorkOrderContextCache_preloadCompleted_idx" ON "WorkOrderContextCache"("preloadCompleted");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WorkOrderContextCache_lastEnrichedAt_idx" ON "WorkOrderContextCache"("lastEnrichedAt");
