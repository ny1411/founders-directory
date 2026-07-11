/*
  Warnings:

  - You are about to drop the column `socialLinks` on the `Company` table. All the data in the column will be lost.
  - You are about to drop the column `socialLinks` on the `Founder` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Company" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "logoUrl" TEXT,
    "vcBacker" TEXT,
    "industry" TEXT,
    "employees" TEXT,
    "location" TEXT,
    "foundedYear" INTEGER,
    "stage" TEXT,
    "raised" TEXT,
    "amountRaised" REAL,
    "website" TEXT,
    "twitterUrl" TEXT,
    "linkedinUrl" TEXT,
    "tags" TEXT,
    "ycUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Company" ("createdAt", "description", "employees", "id", "industry", "logoUrl", "name", "raised", "slug", "updatedAt", "vcBacker", "website") SELECT "createdAt", "description", "employees", "id", "industry", "logoUrl", "name", "raised", "slug", "updatedAt", "vcBacker", "website" FROM "Company";
DROP TABLE "Company";
ALTER TABLE "new_Company" RENAME TO "Company";
CREATE UNIQUE INDEX "Company_slug_key" ON "Company"("slug");
CREATE TABLE "new_Founder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "avatarUrl" TEXT,
    "twitterUrl" TEXT,
    "linkedinUrl" TEXT,
    "bio" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Founder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Founder" ("companyId", "createdAt", "email", "id", "name", "phone", "role", "updatedAt") SELECT "companyId", "createdAt", "email", "id", "name", "phone", "role", "updatedAt" FROM "Founder";
DROP TABLE "Founder";
ALTER TABLE "new_Founder" RENAME TO "Founder";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
