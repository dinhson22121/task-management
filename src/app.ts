import cors from 'cors';
import express from 'express';
import { errorHandler } from './middleware/errorHandler';
import { integrationsRouter } from './routes/integrations';
import { poolsRouter } from './routes/pools';
import { ticketsRouter } from './routes/tickets';
import { usersRouter } from './routes/users';

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.use(poolsRouter);
  app.use('/pools/:id/tickets', ticketsRouter);
  app.use(usersRouter);
  app.use(integrationsRouter);

  app.use(errorHandler);

  return app;
}
