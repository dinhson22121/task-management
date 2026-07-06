import { Mutex } from 'async-mutex';
import { NotFoundError, PoolCapacityExceededError, ValidationError } from '../lib/httpError';
import { parseJiraKey } from '../lib/jiraUrlParser';
import { prisma } from '../prismaClient';
import { getIo } from '../sockets/ioInstance';
import { resolveIssue } from './jiraClient';

const poolLocks = new Map<string, Mutex>();

function lockFor(poolId: string): Mutex {
  let mutex = poolLocks.get(poolId);
  if (!mutex) {
    mutex = new Mutex();
    poolLocks.set(poolId, mutex);
  }
  return mutex;
}

function assertValidLeadMinutes(value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new ValidationError('warningLeadMinutes must be a positive integer (minutes)');
  }
}

function emitPoolCapacityChanged(poolId: string, current: number, capacity: number) {
  getIo()?.to(poolId).emit('PoolCapacityChanged', { poolId, current, capacity });
}

function startOfLocalDay(date: Date = new Date()): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function activeTicketStatusFilter() {
  return { OR: [{ status: { not: 'Done' } }, { status: 'Done', doneAt: { gte: startOfLocalDay() } }] };
}

function activeTicketWhere(poolId: string) {
  return { poolId, ...activeTicketStatusFilter() };
}

export async function createPool(
  ownerId: string,
  name: string,
  capacity: number,
  defaultWarningLeadMinutes?: number,
) {
  if (!name || typeof name !== 'string') throw new ValidationError('name is required');
  if (!Number.isInteger(capacity) || capacity <= 0) {
    throw new ValidationError('capacity must be a positive integer');
  }
  if (defaultWarningLeadMinutes !== undefined) {
    assertValidLeadMinutes(defaultWarningLeadMinutes);

    await prisma.user.update({ where: { id: ownerId }, data: { defaultWarningLeadMinutes } });
  }
  return prisma.pool.create({ data: { ownerId, name, capacity } });
}

export async function listPools(ownerId: string) {
  const pools = await prisma.pool.findMany({
    where: { ownerId },
    include: { _count: { select: { tickets: { where: activeTicketStatusFilter() } } } },
    orderBy: { createdAt: 'asc' },
  });
  return pools.map((pool) => ({
    id: pool.id,
    name: pool.name,
    capacity: pool.capacity,
    createdAt: pool.createdAt,
    ticketCount: pool._count.tickets,
  }));
}

export async function getPool(poolId: string) {
  const pool = await prisma.pool.findUnique({
    where: { id: poolId },
    include: { _count: { select: { tickets: { where: activeTicketStatusFilter() } } } },
  });
  if (!pool) throw new NotFoundError('Pool');
  return {
    id: pool.id,
    name: pool.name,
    capacity: pool.capacity,
    createdAt: pool.createdAt,
    ticketCount: pool._count.tickets,
  };
}

export async function updatePool(poolId: string, data: { name?: string; capacity?: number }) {
  return lockFor(poolId).runExclusive(async () => {
    if (data.capacity !== undefined && (!Number.isInteger(data.capacity) || data.capacity <= 0)) {
      throw new ValidationError('capacity must be a positive integer');
    }
    const existing = await prisma.pool.findUnique({ where: { id: poolId } });
    if (!existing) throw new NotFoundError('Pool');

    const pool = await prisma.pool.update({ where: { id: poolId }, data });
    const current = await prisma.ticket.count({ where: activeTicketWhere(poolId) });
    emitPoolCapacityChanged(poolId, current, pool.capacity);
    return pool;
  });
}

export async function listTickets(poolId: string) {
  const pool = await prisma.pool.findUnique({ where: { id: poolId } });
  if (!pool) throw new NotFoundError('Pool');
  return prisma.ticket.findMany({ where: activeTicketWhere(poolId), orderBy: { addedAt: 'asc' } });
}

export async function listDoneTickets(poolId: string, search?: string) {
  const pool = await prisma.pool.findUnique({ where: { id: poolId } });
  if (!pool) throw new NotFoundError('Pool');
  return prisma.ticket.findMany({
    where: {
      poolId,
      status: 'Done',
      ...(search ? { jiraKey: { startsWith: search } } : {}),
    },
    orderBy: { doneAt: 'desc' },
  });
}

export async function addTicketToPool(poolId: string, jiraUrl: string, manualDueDate?: string, note?: string) {
  return lockFor(poolId).runExclusive(async () => {
    const key = parseJiraKey(jiraUrl);

    const ticket = await prisma.$transaction(
      async (tx) => {
        const pool = await tx.pool.findUnique({ where: { id: poolId } });
        if (!pool) throw new NotFoundError('Pool');

        const current = await tx.ticket.count({ where: activeTicketWhere(poolId) });
        if (current >= pool.capacity) {
          throw new PoolCapacityExceededError(pool.capacity, current);
        }

        const jira = await resolveIssue(jiraUrl, key, pool.ownerId, tx, manualDueDate);

        return tx.ticket.create({
          data: {
            poolId,
            jiraKey: key,
            jiraUrl,
            title: jira.title,
            description: jira.description,
            deadline: jira.deadline,
            status: 'Normal',
            note: note || null,
          },
        });
      },
      { timeout: 10000, maxWait: 10000 },
    );

    const pool = await prisma.pool.findUniqueOrThrow({ where: { id: poolId } });
    const current = await prisma.ticket.count({ where: activeTicketWhere(poolId) });
    getIo()?.to(poolId).emit('TicketAdded', { ticket });
    emitPoolCapacityChanged(poolId, current, pool.capacity);

    return ticket;
  });
}

export async function markTicketDone(poolId: string, ticketId: string) {
  return lockFor(poolId).runExclusive(async () => {
    const existing = await prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!existing || existing.poolId !== poolId) throw new NotFoundError('Ticket');

    const ticket = await prisma.ticket.update({
      where: { id: ticketId },
      data: { status: 'Done', doneAt: new Date() },
    });

    getIo()?.to(poolId).emit('TicketDone', { ticketId });
    return ticket;
  });
}

export async function updateTicket(
  poolId: string,
  ticketId: string,
  data: { deadline?: Date; warningLeadMinutes?: number | null; note?: string | null },
) {
  return lockFor(poolId).runExclusive(async () => {
    const existing = await prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!existing || existing.poolId !== poolId) throw new NotFoundError('Ticket');

    if (data.warningLeadMinutes !== undefined && data.warningLeadMinutes !== null) {
      assertValidLeadMinutes(data.warningLeadMinutes);
    }

    let nextStatus = existing.status;
    let shouldResolve = false;
    if (data.deadline) {
      if (data.deadline.getTime() > Date.now()) {
        nextStatus = 'Normal';
        shouldResolve = existing.status !== 'Normal';
      } else {
        nextStatus = 'Overdue';
      }
    }

    const ticket = await prisma.ticket.update({
      where: { id: ticketId },
      data: { ...data, status: nextStatus },
    });

    if (shouldResolve) {
      getIo()?.to(poolId).emit('TicketResolved', { ticketId });
    }

    return ticket;
  });
}

export async function removeTicket(poolId: string, ticketId: string) {
  return lockFor(poolId).runExclusive(async () => {
    const existing = await prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!existing || existing.poolId !== poolId) throw new NotFoundError('Ticket');

    await prisma.ticket.delete({ where: { id: ticketId } });

    const pool = await prisma.pool.findUniqueOrThrow({ where: { id: poolId } });
    const current = await prisma.ticket.count({ where: activeTicketWhere(poolId) });

    getIo()?.to(poolId).emit('TicketResolved', { ticketId });
    emitPoolCapacityChanged(poolId, current, pool.capacity);
  });
}
