import cron from 'node-cron';
import { Server } from 'socket.io';
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

export async function runDeadlineScan(io: Server): Promise<void> {
  const tickets = await prisma.ticket.findMany({
    where: { status: { not: 'Done' } },
    include: { pool: { include: { owner: true } } },
  });
  const now = new Date();

  for (const ticket of tickets) {
    const lead = ticket.warningLeadMinutes ?? ticket.pool.owner.defaultWarningLeadMinutes;

    if (now >= ticket.deadline) {
      if (ticket.status !== 'Overdue') {
        await prisma.ticket.update({ where: { id: ticket.id }, data: { status: 'Overdue' } });
        await notifyOwner(ticket.id, 'Overdue', ticket.pool.owner);
      }
      io.to(ticket.poolId).emit('TicketOverdue', { ticketId: ticket.id, deadline: ticket.deadline });
    } else if (now >= new Date(ticket.deadline.getTime() - lead * 60000)) {
      if (ticket.status !== 'Warning') {
        await prisma.ticket.update({ where: { id: ticket.id }, data: { status: 'Warning' } });
        await notifyOwner(ticket.id, 'Warning', ticket.pool.owner);
        io.to(ticket.poolId).emit('TicketWarning', {
          ticketId: ticket.id,
          deadline: ticket.deadline,
          minutesRemaining: Math.round((ticket.deadline.getTime() - now.getTime()) / 60000),
        });
      }
    }
  }
}

export function startDeadlineScanner(io: Server) {
  return cron.schedule('*/30 * * * * *', () => {
    runDeadlineScan(io).catch((err) => console.error('deadlineScanner tick failed', err));
  });
}
