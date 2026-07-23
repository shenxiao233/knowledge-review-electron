-- V2 Schema: User profile, sync, and collaboration models

-- UserStatus enum
CREATE TYPE "UserStatus" AS ENUM ('INCOMPLETE', 'ACTIVE', 'SUSPENDED', 'BANNED');

-- InvitationCodeStatus enum
CREATE TYPE "InvitationCodeStatus" AS ENUM ('ACTIVE', 'USED', 'EXPIRED', 'REVOKED');

-- SyncObjectType enum
CREATE TYPE "SyncObjectType" AS ENUM ('DECK', 'DOCUMENT', 'CARD', 'SETTINGS');

-- SyncConflictResolution enum
CREATE TYPE "SyncConflictResolution" AS ENUM ('SERVER_WINS', 'CLIENT_WINS', 'MANUAL');

-- PullRequestStatus enum
CREATE TYPE "PullRequestStatus" AS ENUM ('OPEN', 'MERGED', 'CLOSED', 'REJECTED');

-- PullRequestReviewDecision enum
CREATE TYPE "PullRequestReviewDecision" AS ENUM ('APPROVED', 'CHANGES_REQUESTED', 'COMMENTED');

-- Alter User table: add v2 fields
ALTER TABLE "User" ADD COLUMN "status" "UserStatus" NOT NULL DEFAULT 'INCOMPLETE';
ALTER TABLE "User" ADD COLUMN "uid" VARCHAR(20);
ALTER TABLE "User" ADD COLUMN "nickname" VARCHAR(100);
ALTER TABLE "User" ADD COLUMN "avatar" VARCHAR(500);
ALTER TABLE "User" ADD COLUMN "bio" VARCHAR(1000);
ALTER TABLE "User" ADD COLUMN "email" VARCHAR(255);
ALTER TABLE "User" ADD COLUMN "passwordChangedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE UNIQUE INDEX "User_uid_key" ON "User"("uid");
CREATE INDEX "User_status_createdAt_idx" ON "User"("status", "createdAt");
CREATE INDEX "User_uid_idx" ON "User"("uid");

-- Alter Deck table: add forkable and fork reference
ALTER TABLE "Deck" ADD COLUMN "isForkable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Deck" ADD COLUMN "forkedFromId" UUID;
ALTER TABLE "Deck" ADD CONSTRAINT "Deck_forkedFromId_fkey" FOREIGN KEY ("forkedFromId") REFERENCES "Deck"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Deck_forkedFromId_idx" ON "Deck"("forkedFromId");

-- Device table
CREATE TABLE "Device" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "deviceType" VARCHAR(50) NOT NULL,
    "deviceName" VARCHAR(100) NOT NULL,
    "deviceModel" VARCHAR(100),
    "osVersion" VARCHAR(50),
    "appVersion" VARCHAR(50),
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Device_userId_updatedAt_idx" ON "Device"("userId", "updatedAt");
ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RefreshToken table
CREATE TABLE "RefreshToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RefreshToken_userId_createdAt_idx" ON "RefreshToken"("userId", "createdAt");
CREATE INDEX "RefreshToken_tokenHash_idx" ON "RefreshToken"("tokenHash");
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- InvitationCode table
CREATE TABLE "InvitationCode" (
    "id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "status" "InvitationCodeStatus" NOT NULL DEFAULT 'ACTIVE',
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "currentUses" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "usedById" UUID,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InvitationCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InvitationCode_code_key" ON "InvitationCode"("code");
CREATE INDEX "InvitationCode_status_expiresAt_idx" ON "InvitationCode"("status", "expiresAt");
CREATE INDEX "InvitationCode_code_idx" ON "InvitationCode"("code");
ALTER TABLE "InvitationCode" ADD CONSTRAINT "InvitationCode_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvitationCode" ADD CONSTRAINT "InvitationCode_usedById_fkey" FOREIGN KEY ("usedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- SyncObject table
CREATE TABLE "SyncObject" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "objectType" "SyncObjectType" NOT NULL,
    "objectId" VARCHAR(100) NOT NULL,
    "objectVersion" INTEGER NOT NULL DEFAULT 1,
    "data" JSONB,
    "metadata" JSONB,
    "lastModifiedBy" VARCHAR(50) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SyncObject_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SyncObject_userId_objectType_objectId_key" ON "SyncObject"("userId", "objectType", "objectId");
CREATE INDEX "SyncObject_userId_objectType_updatedAt_idx" ON "SyncObject"("userId", "objectType", "updatedAt");
CREATE INDEX "SyncObject_userId_updatedAt_idx" ON "SyncObject"("userId", "updatedAt");
ALTER TABLE "SyncObject" ADD CONSTRAINT "SyncObject_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SyncObjectHistory table
CREATE TABLE "SyncObjectHistory" (
    "id" UUID NOT NULL,
    "syncObjectId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "modifiedBy" VARCHAR(50) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SyncObjectHistory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SyncObjectHistory_syncObjectId_version_key" ON "SyncObjectHistory"("syncObjectId", "version");
CREATE INDEX "SyncObjectHistory_syncObjectId_version_idx" ON "SyncObjectHistory"("syncObjectId", "version");
ALTER TABLE "SyncObjectHistory" ADD CONSTRAINT "SyncObjectHistory_syncObjectId_fkey" FOREIGN KEY ("syncObjectId") REFERENCES "SyncObject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DeckCollaborator table
CREATE TABLE "DeckCollaborator" (
    "id" UUID NOT NULL,
    "deckId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" VARCHAR(50) NOT NULL,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    CONSTRAINT "DeckCollaborator_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DeckCollaborator_deckId_userId_key" ON "DeckCollaborator"("deckId", "userId");
CREATE INDEX "DeckCollaborator_userId_invitedAt_idx" ON "DeckCollaborator"("userId", "invitedAt");
ALTER TABLE "DeckCollaborator" ADD CONSTRAINT "DeckCollaborator_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "Deck"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeckCollaborator" ADD CONSTRAINT "DeckCollaborator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DeckFork table
CREATE TABLE "DeckFork" (
    "id" UUID NOT NULL,
    "sourceDeckId" UUID NOT NULL,
    "forkedDeckId" UUID NOT NULL,
    "forkedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeckFork_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DeckFork_sourceDeckId_forkedDeckId_key" ON "DeckFork"("sourceDeckId", "forkedDeckId");
CREATE INDEX "DeckFork_sourceDeckId_createdAt_idx" ON "DeckFork"("sourceDeckId", "createdAt");
CREATE INDEX "DeckFork_forkedById_createdAt_idx" ON "DeckFork"("forkedById", "createdAt");
ALTER TABLE "DeckFork" ADD CONSTRAINT "DeckFork_sourceDeckId_fkey" FOREIGN KEY ("sourceDeckId") REFERENCES "Deck"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeckFork" ADD CONSTRAINT "DeckFork_forkedDeckId_fkey" FOREIGN KEY ("forkedDeckId") REFERENCES "Deck"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeckFork" ADD CONSTRAINT "DeckFork_forkedById_fkey" FOREIGN KEY ("forkedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DeckCommit table
CREATE TABLE "DeckCommit" (
    "id" UUID NOT NULL,
    "deckId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "message" VARCHAR(500) NOT NULL,
    "changes" JSONB NOT NULL,
    "parentCommitId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeckCommit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DeckCommit_deckId_createdAt_idx" ON "DeckCommit"("deckId", "createdAt");
CREATE INDEX "DeckCommit_authorId_createdAt_idx" ON "DeckCommit"("authorId", "createdAt");
ALTER TABLE "DeckCommit" ADD CONSTRAINT "DeckCommit_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "Deck"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeckCommit" ADD CONSTRAINT "DeckCommit_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DeckPullRequest table
CREATE TABLE "DeckPullRequest" (
    "id" UUID NOT NULL,
    "sourceDeckId" UUID NOT NULL,
    "targetDeckId" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(2000) NOT NULL,
    "status" "PullRequestStatus" NOT NULL DEFAULT 'OPEN',
    "createdById" UUID NOT NULL,
    "mergedById" UUID,
    "mergedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeckPullRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DeckPullRequest_sourceDeckId_status_createdAt_idx" ON "DeckPullRequest"("sourceDeckId", "status", "createdAt");
CREATE INDEX "DeckPullRequest_targetDeckId_status_createdAt_idx" ON "DeckPullRequest"("targetDeckId", "status", "createdAt");
CREATE INDEX "DeckPullRequest_createdById_createdAt_idx" ON "DeckPullRequest"("createdById", "createdAt");
ALTER TABLE "DeckPullRequest" ADD CONSTRAINT "DeckPullRequest_sourceDeckId_fkey" FOREIGN KEY ("sourceDeckId") REFERENCES "Deck"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeckPullRequest" ADD CONSTRAINT "DeckPullRequest_targetDeckId_fkey" FOREIGN KEY ("targetDeckId") REFERENCES "Deck"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeckPullRequest" ADD CONSTRAINT "DeckPullRequest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DeckPRReview table
CREATE TABLE "DeckPRReview" (
    "id" UUID NOT NULL,
    "pullRequestId" UUID NOT NULL,
    "reviewerId" UUID NOT NULL,
    "decision" "PullRequestReviewDecision" NOT NULL,
    "comment" VARCHAR(2000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeckPRReview_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DeckPRReview_pullRequestId_reviewerId_key" ON "DeckPRReview"("pullRequestId", "reviewerId");
CREATE INDEX "DeckPRReview_reviewerId_createdAt_idx" ON "DeckPRReview"("reviewerId", "createdAt");
ALTER TABLE "DeckPRReview" ADD CONSTRAINT "DeckPRReview_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "DeckPullRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeckPRReview" ADD CONSTRAINT "DeckPRReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DeckPRComment table
CREATE TABLE "DeckPRComment" (
    "id" UUID NOT NULL,
    "pullRequestId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "content" VARCHAR(2000) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeckPRComment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DeckPRComment_pullRequestId_createdAt_idx" ON "DeckPRComment"("pullRequestId", "createdAt");
CREATE INDEX "DeckPRComment_authorId_createdAt_idx" ON "DeckPRComment"("authorId", "createdAt");
ALTER TABLE "DeckPRComment" ADD CONSTRAINT "DeckPRComment_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "DeckPullRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeckPRComment" ADD CONSTRAINT "DeckPRComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
