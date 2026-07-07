import request from 'supertest';
import { buildTestApp, TestAppContext } from './testApp';

interface AppEventPayload {
  ticketId: string;
  [key: string]: unknown;
}

describe('ticket resolution', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await buildTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function makeOverduePool() {
    const pool = await ctx.prisma.pool.create({
      data: { ownerId: ctx.userId, name: `Pool-${Date.now()}`, capacity: 5 },
    });
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

    const resolvedEvents: AppEventPayload[] = [];
    const overdueEvents: AppEventPayload[] = [];
    const onResolved = (p: AppEventPayload) => resolvedEvents.push(p);
    const onOverdue = (p: AppEventPayload) => overdueEvents.push(p);
    ctx.appEvents.on('TicketResolved', onResolved);
    ctx.appEvents.on('TicketOverdue', onOverdue);

    const delRes = await request(base).delete(`/pools/${pool.id}/tickets/${ticket.id}`);
    expect(delRes.status).toBe(204);

    expect(resolvedEvents.some((e) => e.ticketId === ticket.id)).toBe(true);

    overdueEvents.length = 0;
    await ctx.runDeadlineScan();
    expect(overdueEvents.some((e) => e.ticketId === ticket.id)).toBe(false);

    ctx.appEvents.off('TicketResolved', onResolved);
    ctx.appEvents.off('TicketOverdue', onOverdue);
  });

  it('patching a ticket deadline forward clears Overdue status and fires TicketResolved', async () => {
    const { pool, ticket } = await makeOverduePool();
    const base = `http://localhost:${ctx.port}`;

    const resolvedEvents: AppEventPayload[] = [];
    const onResolved = (p: AppEventPayload) => resolvedEvents.push(p);
    ctx.appEvents.on('TicketResolved', onResolved);

    const futureDeadline = new Date(Date.now() + 6 * 60 * 60 * 1000);
    const patchRes = await request(base)
      .patch(`/pools/${pool.id}/tickets/${ticket.id}`)
      .send({ deadline: futureDeadline.toISOString() });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.status).toBe('Normal');

    expect(resolvedEvents.some((e) => e.ticketId === ticket.id)).toBe(true);

    await ctx.runDeadlineScan();
    const after = await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(after.status).toBe('Normal');

    ctx.appEvents.off('TicketResolved', onResolved);
  });
});
