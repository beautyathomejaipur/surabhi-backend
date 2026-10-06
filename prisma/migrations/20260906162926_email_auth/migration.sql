-- Customer table had no rows yet, so this is a safe, non-destructive switch
-- from phone-based identity to email-based identity.
ALTER TABLE "Customer" DROP COLUMN "phone";
ALTER TABLE "Customer" DROP COLUMN "isGuest";
ALTER TABLE "Customer" ALTER COLUMN "email" SET NOT NULL;
CREATE UNIQUE INDEX "Customer_email_key" ON "Customer"("email");

-- CreateTable
CREATE TABLE "EmailOtp" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailOtp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailOtp_email_key" ON "EmailOtp"("email");
