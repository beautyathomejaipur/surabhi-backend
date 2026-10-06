-- CreateTable
CREATE TABLE "OutletPermission" (
    "id" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "actions" TEXT[],

    CONSTRAINT "OutletPermission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OutletPermission_outletId_module_key" ON "OutletPermission"("outletId", "module");

-- AddForeignKey
ALTER TABLE "OutletPermission" ADD CONSTRAINT "OutletPermission_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
