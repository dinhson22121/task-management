import cron from 'node-cron';
import { prisma } from '../prismaClient';

const TRASH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function purgeExpiredTrash(): Promise<void> {
  const cutoff = new Date(Date.now() - TRASH_TTL_MS);
  await prisma.ticket.deleteMany({ where: { deletedAt: { lte: cutoff } } });
}

export function startTicketRetentionScanner() {
  return cron.schedule('0 3 * * *', () => {
    purgeExpiredTrash().catch((err) => console.error('ticketRetentionScanner tick failed', err));
  });
}
