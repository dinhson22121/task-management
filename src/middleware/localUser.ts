import { NextFunction, Request, Response } from 'express';
import { env } from '../env';
import { prisma } from '../prismaClient';

export interface AuthedRequest extends Request {
  user?: { id: string; email: string };
}

let cachedUser: { id: string; email: string } | null = null;

export async function initLocalUser(): Promise<{ id: string; email: string }> {
  const user = await prisma.user.upsert({
    where: { email: env.LOCAL_USER_EMAIL },
    update: {},
    create: { email: env.LOCAL_USER_EMAIL, displayName: 'Local User' },
  });
  cachedUser = { id: user.id, email: user.email };
  return cachedUser;
}

export function attachLocalUser(req: AuthedRequest, _res: Response, next: NextFunction): void {
  if (!cachedUser) {
    throw new Error('Local user not initialized — call initLocalUser() before starting the server');
  }
  req.user = cachedUser;
  next();
}
