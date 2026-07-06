-- AlterTable
ALTER TABLE "IntegrationConnection" ADD COLUMN "cloudId" TEXT;
ALTER TABLE "IntegrationConnection" ADD COLUMN "siteName" TEXT;
ALTER TABLE "IntegrationConnection" ADD COLUMN "siteUrl" TEXT;

-- CreateTable
CREATE TABLE "JiraConfig" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "clientId" TEXT NOT NULL,
    "clientSecretEncrypted" BLOB NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "defaultWarningLeadMinutes" INTEGER NOT NULL DEFAULT 60,
    "appMode" TEXT NOT NULL DEFAULT 'demo',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_User" ("createdAt", "defaultWarningLeadMinutes", "displayName", "email", "id") SELECT "createdAt", "defaultWarningLeadMinutes", "displayName", "email", "id" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
