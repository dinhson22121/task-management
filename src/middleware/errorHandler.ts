import { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/httpError';

export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.error, ...err.extra });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'InternalServerError' });
}
