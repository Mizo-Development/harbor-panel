CREATE TABLE "CatalogCategory" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "position" INTEGER NOT NULL DEFAULT 0,
  "parentId" TEXT,
  CONSTRAINT "CatalogCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CatalogCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CatalogCategory_slug_key" ON "CatalogCategory"("slug");
CREATE INDEX "CatalogCategory_parentId_idx" ON "CatalogCategory"("parentId");
ALTER TABLE "Product" ADD COLUMN "catalogCategoryId" TEXT,
  ADD COLUMN "stock" INTEGER,
  ADD COLUMN "perCustomerLimit" INTEGER,
  ADD CONSTRAINT "Product_catalogCategoryId_fkey" FOREIGN KEY ("catalogCategoryId") REFERENCES "CatalogCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Product_stock_check" CHECK ("stock" IS NULL OR "stock" >= 0),
  ADD CONSTRAINT "Product_perCustomerLimit_check" CHECK ("perCustomerLimit" IS NULL OR "perCustomerLimit" >= 1);
