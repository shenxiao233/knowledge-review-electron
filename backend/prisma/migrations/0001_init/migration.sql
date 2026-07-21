CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');
CREATE TYPE "DeckStatus" AS ENUM ('DRAFT', 'PENDING', 'PUBLISHED', 'DISABLED');

CREATE TABLE "User" (
  "id" UUID NOT NULL,
  "username" VARCHAR(80) NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "role" "UserRole" NOT NULL DEFAULT 'USER',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastLoginAt" TIMESTAMP(3),
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

CREATE TABLE "Deck" (
  "id" UUID NOT NULL,
  "ownerId" UUID NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "description" VARCHAR(2000) NOT NULL,
  "category" VARCHAR(80) NOT NULL,
  "status" "DeckStatus" NOT NULL DEFAULT 'PENDING',
  "currentVersion" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Deck_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Deck_status_updatedAt_idx" ON "Deck"("status", "updatedAt");
CREATE INDEX "Deck_ownerId_updatedAt_idx" ON "Deck"("ownerId", "updatedAt");

CREATE TABLE "DeckVersion" (
  "id" UUID NOT NULL,
  "deckId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "packagePath" TEXT NOT NULL,
  "packageSize" BIGINT NOT NULL,
  "sha256" CHAR(64) NOT NULL,
  "manifest" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeckVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DeckVersion_deckId_version_key" ON "DeckVersion"("deckId", "version");
CREATE INDEX "DeckVersion_deckId_version_idx" ON "DeckVersion"("deckId", "version");

CREATE TABLE "DeckDownload" (
  "id" UUID NOT NULL,
  "deckId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeckDownload_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DeckDownload_deckId_createdAt_idx" ON "DeckDownload"("deckId", "createdAt");
CREATE INDEX "DeckDownload_userId_createdAt_idx" ON "DeckDownload"("userId", "createdAt");

CREATE TABLE "AuditLog" (
  "id" UUID NOT NULL,
  "userId" UUID,
  "action" VARCHAR(120) NOT NULL,
  "targetId" VARCHAR(120),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

ALTER TABLE "Deck" ADD CONSTRAINT "Deck_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DeckVersion" ADD CONSTRAINT "DeckVersion_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "Deck"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeckDownload" ADD CONSTRAINT "DeckDownload_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "Deck"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeckDownload" ADD CONSTRAINT "DeckDownload_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
