import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import { buildTestApp, TestAppContext } from './testApp';

describe('deadline scanner', () => {
  let ctx: TestAppContext;
  let client: ClientSocket;

  beforeAll(async () => {
    ctx = await buildTestApp();
  });

  afterAll(async () => {
    client?.close();
    await ctx.close();
  });

  it('flips a past-deadline ticket to Overdue and keeps re-emitting TicketOverdue on repeated scans', async () => {
    const pool = await ctx.prisma.pool.create({
      data: { ownerId: ctx.userId, name: 'Scan Pool', capacity: 5 },
    });
    const ticket = await ctx.prisma.ticket.create({
      data: {
        poolId: pool.id,
        jiraKey: 'ENG-9',
        jiraUrl: 'https://example.atlassian.net/browse/ENG-9',
        title: 'Overdue ticket',
        deadline: new Date(Date.now() - 60_000),
        status: 'Normal',
      },
    });

    client = ioClient(`http://localhost:${ctx.port}`, {
      transports: ['websocket'],
    });
    await new Promise<void>((resolve, reject) => {
      client.on('connect', () => resolve());
      client.on('connect_error', reject);
    });
    client.emit('joinPool', pool.id);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const overdueEvents: Array<{ ticketId: string; deadline: string }> = [];
    client.on('TicketOverdue', (payload) => overdueEvents.push(payload));

    await ctx.runDeadlineScan(ctx.io);
    await ctx.runDeadlineScan(ctx.io);
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(overdueEvents).toHaveLength(2);
    expect(overdueEvents[0].ticketId).toBe(ticket.id);
    expect(overdueEvents[1].ticketId).toBe(ticket.id);

    const updated = await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(updated.status).toBe('Overdue');
  });
});
