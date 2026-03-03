-- Add fileHash column to DocumentFile table for fast version comparison
ALTER TABLE "DocumentFile" ADD COLUMN "fileHash" TEXT;

-- Create optional index for fast duplicate detection
CREATE INDEX "DocumentFile_fileHash_idx" ON "DocumentFile"("fileHash");
