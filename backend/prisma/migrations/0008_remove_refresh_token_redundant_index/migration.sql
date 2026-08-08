-- tokenHash is now unique, so the previous non-unique lookup index is
-- redundant and adds write amplification to every token rotation.
DROP INDEX IF EXISTS "RefreshToken_tokenHash_idx";
