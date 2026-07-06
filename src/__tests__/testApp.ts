import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'child_process';
import fs from 'fs';
import http from 'http';
import { AddressInfo } from 'net';
import path from 'path';
import { Server } from 'socket.io';

export interface TestAppContext {
  port: number;
  userId: string;
  userEmail: string;
  httpServer: http.Server;
  io: Server;
  prisma: PrismaClient;
  runDeadlineScan: (io: Server) => Promise<void>;
  runJiraPollScan: () => Promise<void>;
  getJiraPollStatus: () => { lastAttemptAt: Date | null; offline: boolean };
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
  const { setIo } = await import('../sockets/ioInstance');
  const { initSockets } = await import('../sockets/index');
  const { initLocalUser } = await import('../middleware/localUser');
  const { runDeadlineScan } = await import('../services/deadlineScanner');
  const { runJiraPollScan, getJiraPollStatus } = await import('../services/jiraPollScanner');

  const app = createApp();
  const httpServer = http.createServer(app);
  const io = new Server(httpServer, { cors: { origin: '*' } });
  setIo(io);
  initSockets(io);

  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const port = (httpServer.address() as AddressInfo).port;

  const localUser = await initLocalUser();

  return {
    port,
    userId: localUser.id,
    userEmail: localUser.email,
    httpServer,
    io,
    prisma,
    runDeadlineScan,
    runJiraPollScan,
    getJiraPollStatus,
    close: async () => {
      await prisma.$disconnect();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      io.close();
      for (const suffix of ['', '-journal', '-wal', '-shm']) {
        const f = dbFile + suffix;
        if (fs.existsSync(f)) fs.unlinkSync(f);
      }
    },
  };
}
