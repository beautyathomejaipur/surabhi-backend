-- AlterTable
ALTER TABLE "Outlet" ADD COLUMN "slug" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Outlet_slug_key" ON "Outlet"("slug");
