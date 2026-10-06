-- CreateEnum
CREATE TYPE "OutletAvailability" AS ENUM ('OPEN', 'BUSY', 'TEMPORARILY_CLOSED');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('STAFF', 'VENDOR', 'SYSTEM');

-- AlterTable
ALTER TABLE "Outlet" ADD COLUMN     "address" TEXT,
ADD COLUMN     "alternatePhone" TEXT,
ADD COLUMN     "availability" "OutletAvailability" NOT NULL DEFAULT 'OPEN',
ADD COLUMN     "commissionPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "createdByLabel" TEXT,
ADD COLUMN     "deliveryCharge" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "foodTypes" "DietaryType"[],
ADD COLUMN     "imagePublicId" TEXT,
ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "minOrderTimeMins" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "minOrderValue" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "passwordHash" TEXT,
ADD COLUMN     "weeklyOff" TEXT NOT NULL DEFAULT 'NONE',
ADD COLUMN     "workingHoursEnd" TEXT NOT NULL DEFAULT '22:00',
ADD COLUMN     "workingHoursStart" TEXT NOT NULL DEFAULT '10:00';

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorType" "AuditActorType" NOT NULL,
    "actorId" TEXT,
    "actorLabel" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Outlet_email_key" ON "Outlet"("email");

