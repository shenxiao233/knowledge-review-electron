-- Supports incremental cleanup of retained sync history without scanning
-- the whole table for every maintenance run.
CREATE INDEX "SyncObjectHistory_createdAt_idx"
ON "SyncObjectHistory"("createdAt");
