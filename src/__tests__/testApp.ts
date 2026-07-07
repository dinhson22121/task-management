import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'child_process';
import { EventEmitter } from 'events';
import fs from 'fs';
import http from 'http';
import { AddressInfo } from 'net';
import path from 'path';

export interface TestAppContext {
  port: number;
  userId: string;
  userEmail: string;
  httpServer: http.Server;
  appEvents: EventEmitter;
  prisma: PrismaClient;
  runDeadlineScan: () => Promise<void>;
  runJiraPollScan: () => Promise<void>;
  getJiraPollStatus: () => { lastAttemptAt: Date | null; offline: boolean };
  purgeExpiredTrash: () => Promise<void>;
  close: () => Promise<void>;
}

export async function buildTestApp(): Promise<TestAppContext> {
  const dbFile = path.join(
    process.cwd(),
    'prisma',
    `test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
  process.env.DATABASE_URL = `file:${dbFile}?connection_limit=1`;

  const prismaBin = path.join(process.cwd(), 'node_modules', '.bin', 'prisma');
  execFileSync(prismaBin, ['db', 'push', '--skip-generate', '--accept-data-loss'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'pipe',
  });

  const { createApp } = await import('../app');
  const { prisma } = await import('../prismaClient');
  const { appEvents } = await import('../lib/appEvents');
  const { initLocalUser } = await import('../middleware/localUser');
  const { runDeadlineScan } = await import('../services/deadlineScanner');
  const { runJiraPollScan, getJiraPollStatus } = await import('../services/jiraPollScanner');
  const { purgeExpiredTrash } = await import('../services/ticketRetentionScanner');

  const app = createApp();
  const httpServer = http.createServer(app);

  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const port = (httpServer.address() as AddressInfo).port;

  const localUser = await initLocalUser();

  return {
    port,
    userId: localUser.id,
    userEmail: localUser.email,
    httpServer,
    appEvents,
    prisma,
    runDeadlineScan,
    runJiraPollScan,
    getJiraPollStatus,
    purgeExpiredTrash,
    close: async () => {
      await prisma.$disconnect();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      for (const suffix of ['', '-journal', '-wal', '-shm']) {
        const f = dbFile + suffix;
        if (fs.existsSync(f)) fs.unlinkSync(f);
      }
    },
  };
}
