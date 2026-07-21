CREATE TYPE "DeckVersionStatus" AS ENUM ('PENDING', 'PUBLISHED', 'REJECTED');

ALTER TABLE "Deck" ADD COLUMN "publishedVersion" INTEGER;

ALTER TABLE "DeckVersion"
ADD COLUMN "status" "DeckVersionStatus" NOT NULL DEFAULT 'PENDING';

UPDATE "DeckVersion" SET "status" = 'PUBLISHED';
UPDATE "Deck"
SET "publishedVersion" = NULLIF("currentVersion", 0);

CREATE INDEX "DeckVersion_deckId_status_version_idx"
ON "DeckVersion"("deckId", "status", "version");
