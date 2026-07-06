import request from 'supertest';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import { buildTestApp, TestAppContext } from './testApp';

interface SocketEvent {
  ticketId: string;
  [key: string]: unknown;
}

describe('ticket resolution', () => {
  let ctx: TestAppContext;
  let client: ClientSocket;

  beforeAll(async () => {
    ctx = await buildTestApp();
    client = ioClient(`http://localhost:${ctx.port}`, {
      transports: ['websocket'],
    });
    await new Promise<void>((resolve, reject) => {
      client.on('connect', () => resolve());
      client.on('connect_error', reject);
    });
  });

  afterAll(async () => {
    client.close();
    await ctx.close();
  });

  async function makeOverduePool() {
    const pool = await ctx.prisma.pool.create({
      data: { ownerId: ctx.userId, name: `Pool-${Date.now()}`, capacity: 5 },
    });
    client.emit('joinPool', pool.id);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const ticket = await ctx.prisma.ticket.create({
      data: {
        poolId: pool.id,
        jiraKey: `ENG-${Math.floor(Math.random() * 1_000_000)}`,
        jiraUrl: 'https://example.atlassian.net/browse/ENG-X',
        title: 'Overdue ticket',
        deadline: new Date(Date.now() - 60_000),
        status: 'Overdue',
      },
    });
    return { pool, ticket };
  }

  it('removing an overdue ticket stops further TicketOverdue emissions and fires TicketResolved', async () => {
    const { pool, ticket } = await makeOverduePool();
    const base = `http://localhost:${ctx.port}`;

    const resolvedEvents: SocketEvent[] = [];
    const overdueEvents: SocketEvent[] = [];
    const onResolved = (p: SocketEvent) => resolvedEvents.push(p);
    const onOverdue = (p: SocketEvent) => overdueEvents.push(p);
    client.on('TicketResolved', onResolved);
    client.on('TicketOverdue', onOverdue);

    const delRes = await request(base).delete(`/pools/${pool.id}/tickets/${ticket.id}`);
    expect(delRes.status).toBe(204);

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(resolvedEvents.some((e) => e.ticketId === ticket.id)).toBe(true);

    overdueEvents.length = 0;
    await ctx.runDeadlineScan(ctx.io);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(overdueEvents.some((e) => e.ticketId === ticket.id)).toBe(false);

    client.off('TicketResolved', onResolved);
    client.off('TicketOverdue', onOverdue);
  });

  it('patching a ticket deadline forward clears Overdue status and fires TicketResolved', async () => {
    const { pool, ticket } = await makeOverduePool();
    const base = `http://localhost:${ctx.port}`;

    const resolvedEvents: SocketEvent[] = [];
    const onResolved = (p: SocketEvent) => resolvedEvents.push(p);
    client.on('TicketResolved', onResolved);

    const futureDeadline = new Date(Date.now() + 6 * 60 * 60 * 1000);
    const patchRes = await request(base)
      .patch(`/pools/${pool.id}/tickets/${ticket.id}`)
      .send({ deadline: futureDeadline.toISOString() });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.status).toBe('Normal');

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(resolvedEvents.some((e) => e.ticketId === ticket.id)).toBe(true);

    await ctx.runDeadlineScan(ctx.io);
    const after = await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(after.status).toBe('Normal');

    client.off('TicketResolved', onResolved);
  });
});
