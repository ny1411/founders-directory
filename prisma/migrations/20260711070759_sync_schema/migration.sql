/*
  Warnings:

  - You are about to drop the column `amountRaised` on the `Company` table. All the data in the column will be lost.
  - You are about to drop the column `raised` on the `Company` table. All the data in the column will be lost.
  - You are about to drop the column `stage` on the `Company` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Company" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "oneLiner" TEXT,
    "description" TEXT,
    "logoUrl" TEXT,
    "vcBacker" TEXT,
    "industry" TEXT,
    "employees" TEXT,
    "location" TEXT,
    "foundedYear" INTEGER,
    "website" TEXT,
    "twitterUrl" TEXT,
    "linkedinUrl" TEXT,
    "tags" TEXT,
    "ycUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Company" ("createdAt", "description", "employees", "foundedYear", "id", "industry", "linkedinUrl", "location", "logoUrl", "name", "slug", "tags", "twitterUrl", "updatedAt", "vcBacker", "website", "ycUrl") SELECT "createdAt", "description", "employees", "foundedYear", "id", "industry", "linkedinUrl", "location", "logoUrl", "name", "slug", "tags", "twitterUrl", "updatedAt", "vcBacker", "website", "ycUrl" FROM "Company";
DROP TABLE "Company";
ALTER TABLE "new_Company" RENAME TO "Company";
CREATE UNIQUE INDEX "Company_slug_key" ON "Company"("slug");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
