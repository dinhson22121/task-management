import cors from 'cors';
import express from 'express';
import { errorHandler } from './middleware/errorHandler';
import { requireLocalApiToken } from './middleware/localApiToken';
import { integrationsRouter } from './routes/integrations';
import { poolsRouter } from './routes/pools';
import { ticketsRouter } from './routes/tickets';
import { usersRouter } from './routes/users';

// Electron renders the UI from a file:// page, which sends `Origin: null` on
// cross-origin fetches. Only allow that (or same-origin/no-Origin requests
// like curl or supertest) — never reflect an arbitrary http(s) origin.
const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (!origin || origin === 'null') {
      callback(null, true);
      return;
    }
    callback(new Error('Not allowed by CORS'));
  },
};

export function createApp() {
  const app = express();
  app.use(cors(corsOptions));
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.use(requireLocalApiToken);
  app.use(poolsRouter);
  app.use('/pools/:id/tickets', ticketsRouter);
  app.use(usersRouter);
  app.use(integrationsRouter);

  app.use(errorHandler);

  return app;
}
