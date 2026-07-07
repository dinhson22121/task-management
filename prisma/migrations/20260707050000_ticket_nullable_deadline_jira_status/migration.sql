-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Ticket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "poolId" TEXT NOT NULL,
    "jiraKey" TEXT NOT NULL,
    "jiraUrl" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "deadline" DATETIME,
    "warningLeadMinutes" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'Normal',
    "jiraStatus" TEXT,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "doneAt" DATETIME,
    "note" TEXT,
    CONSTRAINT "Ticket_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "Pool" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Ticket" ("id", "poolId", "jiraKey", "jiraUrl", "title", "description", "deadline", "warningLeadMinutes", "status", "addedAt", "doneAt", "note")
SELECT "id", "poolId", "jiraKey", "jiraUrl", "title", "description", "deadline", "warningLeadMinutes", "status", "addedAt", "doneAt", "note" FROM "Ticket";
DROP TABLE "Ticket";
ALTER TABLE "new_Ticket" RENAME TO "Ticket";
CREATE UNIQUE INDEX "Ticket_poolId_jiraKey_key" ON "Ticket"("poolId", "jiraKey");
CREATE INDEX "Ticket_deadline_idx" ON "Ticket"("deadline");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
