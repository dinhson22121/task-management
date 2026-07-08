import { NextFunction, Request, Response } from 'express';
import { env } from '../env';

/**
 * Guards the embedded API against any other local process (browser tab, LAN peer)
 * reaching it. Skipped when LOCAL_API_TOKEN is unset (dev/test) — Electron's main
 * process always sets it before starting the server.
 */
export function requireLocalApiToken(req: Request, res: Response, next: NextFunction): void {
  if (!env.LOCAL_API_TOKEN) {
    next();
    return;
  }
  if (req.header('x-local-api-token') !== env.LOCAL_API_TOKEN) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}
