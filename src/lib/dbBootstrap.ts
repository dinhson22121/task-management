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
}
