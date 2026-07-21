CREATE TYPE "CategoryStatus" AS ENUM ('PENDING', 'PUBLISHED', 'REJECTED');

CREATE TABLE "MarketCategory" (
  "id" UUID NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "status" "CategoryStatus" NOT NULL DEFAULT 'PENDING',
  "createdById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MarketCategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarketCategory_name_key" ON "MarketCategory"("name");
CREATE INDEX "MarketCategory_status_updatedAt_idx" ON "MarketCategory"("status", "updatedAt");

ALTER TABLE "MarketCategory"
ADD CONSTRAINT "MarketCategory_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
