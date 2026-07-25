-- Alter User.avatar from VARCHAR(500) to TEXT
-- The original migration 0004 created this column as VARCHAR(500),
-- but the Prisma schema declares it as @db.Text.
-- Base64 avatar data URLs (even compressed) can exceed 500 characters,
-- causing database-level truncation or errors.
ALTER TABLE "User" ALTER COLUMN "avatar" TYPE TEXT;
