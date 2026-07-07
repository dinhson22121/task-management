import cron from 'node-cron';
import { appEvents } from '../lib/appEvents';
import { env } from '../env';
import { prisma } from '../prismaClient';
import { getNotificationProvider } from './notificationProviders';

async function notifyOwner(
  ticketId: string,
  type: 'Warning' | 'Overdue',
  owner: { id: string; email: string },
) {
  await prisma.notificationEvent.create({ data: { ticketId, type, channel: 'chat' } });
  const provider = getNotificationProvider(env.NOTIFIER_PROVIDER_NAME);
  await provider.send({ id: ticketId, ticketId, type, channel: 'chat' }, owner);
}

const PENDING_DUE_DATE_TIMEOUT_MS = 24 * 60 * 60 * 1000;

export async function runDeadlineScan(): Promise<void> {
  const tickets = await prisma.ticket.findMany({
    where: { status: { not: 'Done' } },
    include: { pool: { include: { owner: true } } },
  });
  const now = new Date();

  for (const ticket of tickets) {
    if (!ticket.deadline) {
      if (ticket.status !== 'Overdue' && now.getTime() - ticket.addedAt.getTime() >= PENDING_DUE_DATE_TIMEOUT_MS) {
        await prisma.ticket.update({ where: { id: ticket.id }, data: { status: 'Overdue' } });
        await notifyOwner(ticket.id, 'Overdue', ticket.pool.owner);
        appEvents.emit('TicketOverdue', { ticketId: ticket.id, poolId: ticket.poolId, deadline: null });
      }
      continue;
    }

    const lead = ticket.warningLeadMinutes ?? ticket.pool.owner.defaultWarningLeadMinutes;

    if (now >= ticket.deadline) {
      if (ticket.status !== 'Overdue') {
        await prisma.ticket.update({ where: { id: ticket.id }, data: { status: 'Overdue' } });
        await notifyOwner(ticket.id, 'Overdue', ticket.pool.owner);
      }
      appEvents.emit('TicketOverdue', { ticketId: ticket.id, poolId: ticket.poolId, deadline: ticket.deadline });
    } else if (now >= new Date(ticket.deadline.getTime() - lead * 60000)) {
      if (ticket.status !== 'Warning') {
        await prisma.ticket.update({ where: { id: ticket.id }, data: { status: 'Warning' } });
        await notifyOwner(ticket.id, 'Warning', ticket.pool.owner);
        appEvents.emit('TicketWarning', {
          ticketId: ticket.id,
          poolId: ticket.poolId,
          deadline: ticket.deadline,
          minutesRemaining: Math.round((ticket.deadline.getTime() - now.getTime()) / 60000),
        });
      }
    } else if (ticket.status === 'Warning' || ticket.status === 'Overdue') {
      // No longer within the warning window (e.g. lead time was reduced) — demote back to Normal.
      await prisma.ticket.update({ where: { id: ticket.id }, data: { status: 'Normal' } });
      appEvents.emit('TicketResolved', { ticketId: ticket.id, poolId: ticket.poolId });
    }
  }
}

export function startDeadlineScanner() {
  return cron.schedule('*/30 * * * * *', () => {
    runDeadlineScan().catch((err) => console.error('deadlineScanner tick failed', err));
  });
}
