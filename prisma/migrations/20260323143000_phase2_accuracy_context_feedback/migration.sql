-- Add technician selection reinforcement signal to chunk rows
ALTER TABLE "DocumentChunk"
  ADD COLUMN IF NOT EXISTS "technicianSelectionCount" INTEGER NOT NULL DEFAULT 0;

-- Add intent + compressed memory fields for technician conversation cache
ALTER TABLE "WorkOrderContextCache"
  ADD COLUMN IF NOT EXISTS "queryIntent" TEXT,
  ADD COLUMN IF NOT EXISTS "compressedConversationContext" TEXT;

-- Optional index for intent analytics/routing introspection
CREATE INDEX IF NOT EXISTS "WorkOrderContextCache_queryIntent_idx"
  ON "WorkOrderContextCache"("queryIntent");
