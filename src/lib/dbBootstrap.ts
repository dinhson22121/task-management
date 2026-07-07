import fs from 'fs';
import path from 'path';
import { prisma } from '../prismaClient';

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'prisma', 'migrations');

async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("${table}")`);
  return rows.some((r) => r.name === column);
}

async function ensureUserAppModeColumn(): Promise<void> {
  if (await columnExists('User', 'appMode')) return;
  await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN "appMode" TEXT NOT NULL DEFAULT 'demo'`);
}

async function ensureJiraConfigTable(): Promise<void> {
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "JiraConfig" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "clientId" TEXT NOT NULL,
    "clientSecretEncrypted" BLOB NOT NULL,
    "updatedAt" DATETIME NOT NULL
  )`);
}

async function ensureIntegrationConnectionCloudColumns(): Promise<void> {
  for (const column of ['cloudId', 'siteUrl', 'siteName']) {
    if (await columnExists('IntegrationConnection', column)) continue;
    await prisma.$executeRawUnsafe(`ALTER TABLE "IntegrationConnection" ADD COLUMN "${column}" TEXT`);
  }
}

async function ensureUserWorkingTimeColumns(): Promise<void> {
  if (!(await columnExists('User', 'workingHourStart'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN "workingHourStart" INTEGER NOT NULL DEFAULT 480`);
  }
  if (!(await columnExists('User', 'workingHourEnd'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN "workingHourEnd" INTEGER NOT NULL DEFAULT 1020`);
  }
  if (!(await columnExists('User', 'timeFormat'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN "timeFormat" TEXT NOT NULL DEFAULT '24h'`);
  }
}

async function ensureTicketDoneAtColumn(): Promise<void> {
  if (await columnExists('Ticket', 'doneAt')) return;
  await prisma.$executeRawUnsafe(`ALTER TABLE "Ticket" ADD COLUMN "doneAt" DATETIME`);
}

async function ensureUserJiraPollIntervalColumn(): Promise<void> {
  if (await columnExists('User', 'jiraPollIntervalSeconds')) return;
  await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN "jiraPollIntervalSeconds" INTEGER NOT NULL DEFAULT 300`);
}

async function ensureTicketNoteColumn(): Promise<void> {
  if (await columnExists('Ticket', 'note')) return;
  await prisma.$executeRawUnsafe(`ALTER TABLE "Ticket" ADD COLUMN "note" TEXT`);
}

async function ensureTicketSoftRemoveColumns(): Promise<void> {
  if (!(await columnExists('Ticket', 'removedFromActiveAt'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Ticket" ADD COLUMN "removedFromActiveAt" DATETIME`);
  }
  if (!(await columnExists('Ticket', 'deletedAt'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Ticket" ADD COLUMN "deletedAt" DATETIME`);
  }
}

async function ensureUserVoiceProviderColumns(): Promise<void> {
  if (!(await columnExists('User', 'voiceProvider'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN "voiceProvider" TEXT NOT NULL DEFAULT 'piper'`);
  }
  if (!(await columnExists('User', 'elevenLabsApiKeyEncrypted'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN "elevenLabsApiKeyEncrypted" BLOB`);
  }
  if (!(await columnExists('User', 'elevenLabsVoiceId'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN "elevenLabsVoiceId" TEXT`);
  }
  if (!(await columnExists('User', 'voiceLanguage'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN "voiceLanguage" TEXT NOT NULL DEFAULT 'vi'`);
  }
}

async function ensureIntegrationConnectionAuthMethodColumns(): Promise<void> {
  if (!(await columnExists('IntegrationConnection', 'authMethod'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "IntegrationConnection" ADD COLUMN "authMethod" TEXT NOT NULL DEFAULT 'oauth'`);
  }
  if (!(await columnExists('IntegrationConnection', 'email'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "IntegrationConnection" ADD COLUMN "email" TEXT`);
  }
}

async function ensureTicketDeadlineNullableAndJiraStatus(): Promise<void> {
  const columns = await prisma.$queryRawUnsafe<Array<{ name: string; notnull: number }>>(
    `PRAGMA table_info("Ticket")`,
  );
  const deadlineColumn = columns.find((c) => c.name === 'deadline');
  if (deadlineColumn && deadlineColumn.notnull === 0) return;

  await prisma.$executeRawUnsafe(`PRAGMA foreign_keys=OFF`);
  await prisma.$executeRawUnsafe(`CREATE TABLE "new_Ticket" (
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
  )`);
  await prisma.$executeRawUnsafe(`INSERT INTO "new_Ticket" ("id", "poolId", "jiraKey", "jiraUrl", "title", "description", "deadline", "warningLeadMinutes", "status", "addedAt", "doneAt", "note")
    SELECT "id", "poolId", "jiraKey", "jiraUrl", "title", "description", "deadline", "warningLeadMinutes", "status", "addedAt", "doneAt", "note" FROM "Ticket"`);
  await prisma.$executeRawUnsafe(`DROP TABLE "Ticket"`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "new_Ticket" RENAME TO "Ticket"`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX "Ticket_poolId_jiraKey_key" ON "Ticket"("poolId", "jiraKey")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX "Ticket_deadline_idx" ON "Ticket"("deadline")`);
  await prisma.$executeRawUnsafe(`PRAGMA foreign_keys=ON`);
}

export async function ensureSchema(): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='User'",
  );
  if (rows.length === 0) {
    const dirs = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((d) => fs.statSync(path.join(MIGRATIONS_DIR, d)).isDirectory())
      .sort();

    for (const dir of dirs) {
      const sqlPath = path.join(MIGRATIONS_DIR, dir, 'migration.sql');
      if (!fs.existsSync(sqlPath)) continue;
      const statements = fs
        .readFileSync(sqlPath, 'utf8')
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);
      for (const statement of statements) {
        await prisma.$executeRawUnsafe(statement);
      }
    }
  }

  await ensureUserAppModeColumn();
  await ensureJiraConfigTable();
  await ensureIntegrationConnectionCloudColumns();
  await ensureUserWorkingTimeColumns();
  await ensureTicketDoneAtColumn();
  await ensureUserJiraPollIntervalColumn();
  await ensureTicketNoteColumn();
  await ensureTicketDeadlineNullableAndJiraStatus();
  await ensureIntegrationConnectionAuthMethodColumns();
  await ensureTicketSoftRemoveColumns();
  await ensureUserVoiceProviderColumns();
}
