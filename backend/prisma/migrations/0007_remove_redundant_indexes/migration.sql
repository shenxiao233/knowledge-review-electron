-- Unique constraints already provide the lookup indexes below. Keeping both
-- copies wastes disk and adds write amplification on every sync/login write.
DROP INDEX IF EXISTS "User_uid_idx";
DROP INDEX IF EXISTS "DeckVersion_deckId_version_idx";
DROP INDEX IF EXISTS "InvitationCode_code_idx";
DROP INDEX IF EXISTS "SyncObjectHistory_syncObjectId_version_idx";

-- Refresh-token cleanup uses expiresAt as its first filter.
CREATE UNIQUE INDEX IF NOT EXISTS "RefreshToken_tokenHash_key"
ON "RefreshToken"("tokenHash");

CREATE INDEX IF NOT EXISTS "RefreshToken_expiresAt_idx"
ON "RefreshToken"("expiresAt");
