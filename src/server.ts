import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { createApp } from './app';
import { env } from './env';
import { ensureSchema } from './lib/dbBootstrap';
import { initLocalUser } from './middleware/localUser';
import { startDeadlineScanner } from './services/deadlineScanner';
import { startJiraPollScanner } from './services/jiraPollScanner';
import { setIo } from './sockets/ioInstance';
import { initSockets } from './sockets/index';

export interface StartedServer {
  app: express.Express;
  httpServer: http.Server;
  io: Server;
  port: number;
}

export async function startServer(): Promise<StartedServer> {
  await ensureSchema();
  await initLocalUser();

  const app = createApp();
  const httpServer = http.createServer(app);
  const io = new Server(httpServer, { cors: { origin: '*' } });

  setIo(io);
  initSockets(io);
  startDeadlineScanner(io);
  startJiraPollScanner();

  await new Promise<void>((resolve) => httpServer.listen(env.PORT, resolve));

  return { app, httpServer, io, port: env.PORT };
}

if (require.main === module) {
  startServer()
    .then(({ port }) => console.log(`Task Pool Manager backend listening on :${port}`))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
