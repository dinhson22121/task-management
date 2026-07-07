import express from 'express';
import http from 'http';
import { createApp } from './app';
import { env } from './env';
import { ensureSchema } from './lib/dbBootstrap';
import { initLocalUser } from './middleware/localUser';
import { startDeadlineScanner } from './services/deadlineScanner';
import { startJiraPollScanner } from './services/jiraPollScanner';
import { startTicketRetentionScanner } from './services/ticketRetentionScanner';

export interface StartedServer {
  app: express.Express;
  httpServer: http.Server;
  port: number;
}

export async function startServer(): Promise<StartedServer> {
  await ensureSchema();
  await initLocalUser();

  const app = createApp();
  const httpServer = http.createServer(app);

  startDeadlineScanner();
  startJiraPollScanner();
  startTicketRetentionScanner();

  await new Promise<void>((resolve) => httpServer.listen(env.PORT, resolve));

  return { app, httpServer, port: env.PORT };
}

if (require.main === module) {
  startServer()
    .then(({ port }) => console.log(`Deadline Buddy backend listening on :${port}`))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
