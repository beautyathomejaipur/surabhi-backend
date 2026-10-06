-- CreateEnum
CREATE TYPE "VendorRequestStatus" AS ENUM ('NEW', 'CONTACTED', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "VendorRequest" (
    "id" TEXT NOT NULL,
    "restaurantName" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "stationName" TEXT NOT NULL,
    "stationId" TEXT,
    "fssaiLicenseNo" TEXT,
    "foodTypes" "DietaryType"[],
    "yearsInBusiness" INTEGER,
    "message" TEXT,
    "status" "VendorRequestStatus" NOT NULL DEFAULT 'NEW',
    "adminNotes" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "outletId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT,
    "pageViewId" TEXT,
    "path" TEXT NOT NULL,
    "referrer" TEXT,
    "visitorId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "device" TEXT NOT NULL,
    "browser" TEXT,
    "utmSource" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VendorRequest_status_createdAt_idx" ON "VendorRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "VendorRequest_phone_idx" ON "VendorRequest"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsEvent_pageViewId_key" ON "AnalyticsEvent"("pageViewId");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_createdAt_idx" ON "AnalyticsEvent"("createdAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_type_createdAt_idx" ON "AnalyticsEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_sessionId_idx" ON "AnalyticsEvent"("sessionId");

-- AddForeignKey
ALTER TABLE "VendorRequest" ADD CONSTRAINT "VendorRequest_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE SET NULL ON UPDATE CASCADE;
