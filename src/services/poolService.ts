import { Mutex } from 'async-mutex';
import { appEvents } from '../lib/appEvents';
import { NotFoundError, PoolCapacityExceededError, ValidationError } from '../lib/httpError';
import { parseJiraKey } from '../lib/jiraUrlParser';
import { prisma } from '../prismaClient';
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
  appEvents.emit('PoolCapacityChanged', { poolId, current, capacity });
}

function startOfLocalDay(date: Date = new Date()): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function activeTicketStatusFilter() {
  return {
    deletedAt: null,
    removedFromActiveAt: null,
    OR: [{ status: { not: 'Done' } }, { status: 'Done', doneAt: { gte: startOfLocalDay() } }],
  };
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
      deletedAt: null,
      ...(search ? { jiraKey: { startsWith: search } } : {}),
    },
    orderBy: { doneAt: 'desc' },
  });
}

export async function addTicketToPool(
  poolId: string,
  jiraUrl: string,
  manualDueDate?: string,
  note?: string,
  confirmNoDueDate = false,
) {
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

        const jira = await resolveIssue(jiraUrl, key, pool.ownerId, tx, manualDueDate, confirmNoDueDate);

        return tx.ticket.create({
          data: {
            poolId,
            jiraKey: key,
            jiraUrl,
            title: jira.title,
            description: jira.description,
            deadline: jira.deadline,
            status: 'Normal',
            jiraStatus: jira.jiraStatus,
            note: note || null,
          },
        });
      },
      { timeout: 10000, maxWait: 10000 },
    );

    const pool = await prisma.pool.findUniqueOrThrow({ where: { id: poolId } });
    const current = await prisma.ticket.count({ where: activeTicketWhere(poolId) });
    appEvents.emit('TicketAdded', { ticket });
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

    appEvents.emit('TicketDone', { ticketId, poolId });
    return ticket;
  });
}

export async function undoTicketDone(poolId: string, ticketId: string) {
  return lockFor(poolId).runExclusive(async () => {
    const existing = await prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!existing || existing.poolId !== poolId) throw new NotFoundError('Ticket');
    if (existing.status !== 'Done') throw new ValidationError('Ticket is not Done');

    const pool = await prisma.pool.findUniqueOrThrow({ where: { id: poolId } });
    const currentExcludingThis = await prisma.ticket.count({
      where: { ...activeTicketWhere(poolId), id: { not: ticketId } },
    });
    if (currentExcludingThis >= pool.capacity) {
      throw new PoolCapacityExceededError(pool.capacity, currentExcludingThis);
    }

    const nextStatus = existing.deadline && existing.deadline.getTime() <= Date.now() ? 'Overdue' : 'Normal';
    const ticket = await prisma.ticket.update({
      where: { id: ticketId },
      data: { status: nextStatus, doneAt: null, removedFromActiveAt: null },
    });

    const current = await prisma.ticket.count({ where: activeTicketWhere(poolId) });
    appEvents.emit('TicketUpdated', { ticketId, poolId });
    emitPoolCapacityChanged(poolId, current, pool.capacity);
    return ticket;
  });
}

export async function updateTicket(
  poolId: string,
  ticketId: string,
  data: {
    deadline?: Date;
    warningLeadMinutes?: number | null;
    note?: string | null;
    jiraStatus?: string | null;
  },
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
      appEvents.emit('TicketResolved', { ticketId, poolId });
    }
    appEvents.emit('TicketUpdated', { ticketId, poolId });

    return ticket;
  });
}

export async function removeTicket(poolId: string, ticketId: string) {
  return lockFor(poolId).runExclusive(async () => {
    const existing = await prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!existing || existing.poolId !== poolId) throw new NotFoundError('Ticket');

    if (existing.status === 'Done') {
      // Keep the Done record for history — only hide it from the active view.
      await prisma.ticket.update({ where: { id: ticketId }, data: { removedFromActiveAt: new Date() } });
    } else {
      await prisma.ticket.delete({ where: { id: ticketId } });
    }

    const pool = await prisma.pool.findUniqueOrThrow({ where: { id: poolId } });
    const current = await prisma.ticket.count({ where: activeTicketWhere(poolId) });

    appEvents.emit('TicketResolved', { ticketId, poolId });
    emitPoolCapacityChanged(poolId, current, pool.capacity);
  });
}

export async function softDeleteDoneTicket(poolId: string, ticketId: string) {
  return lockFor(poolId).runExclusive(async () => {
    const existing = await prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!existing || existing.poolId !== poolId) throw new NotFoundError('Ticket');
    if (existing.status !== 'Done') throw new ValidationError('Ticket is not Done');

    await prisma.ticket.update({ where: { id: ticketId }, data: { deletedAt: new Date() } });

    const pool = await prisma.pool.findUniqueOrThrow({ where: { id: poolId } });
    const current = await prisma.ticket.count({ where: activeTicketWhere(poolId) });
    appEvents.emit('TicketUpdated', { ticketId, poolId });
    emitPoolCapacityChanged(poolId, current, pool.capacity);
  });
}
