import { buildTestApp, TestAppContext } from './testApp';

describe('deadline scanner', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await buildTestApp();
  });

  afterAll(async () => {
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

    const overdueEvents: Array<{ ticketId: string; deadline: string }> = [];
    const onOverdue = (payload: { ticketId: string; deadline: string }) => overdueEvents.push(payload);
    ctx.appEvents.on('TicketOverdue', onOverdue);

    await ctx.runDeadlineScan();
    await ctx.runDeadlineScan();

    ctx.appEvents.off('TicketOverdue', onOverdue);

    expect(overdueEvents).toHaveLength(2);
    expect(overdueEvents[0].ticketId).toBe(ticket.id);
    expect(overdueEvents[1].ticketId).toBe(ticket.id);

    const updated = await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(updated.status).toBe('Overdue');
  });

  it('flips a ticket with no due date to Overdue once it has been pending for over 24 hours', async () => {
    const pool = await ctx.prisma.pool.create({
      data: { ownerId: ctx.userId, name: 'Pending Pool', capacity: 5 },
    });
    const ticket = await ctx.prisma.ticket.create({
      data: {
        poolId: pool.id,
        jiraKey: 'ENG-10',
        jiraUrl: 'https://example.atlassian.net/browse/ENG-10',
        title: 'No due date ticket',
        deadline: null,
        status: 'Normal',
        addedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      },
    });

    await ctx.runDeadlineScan();

    const updated = await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(updated.status).toBe('Overdue');
  });

  it('leaves a ticket with no due date as Normal within the 24 hour grace period', async () => {
    const pool = await ctx.prisma.pool.create({
      data: { ownerId: ctx.userId, name: 'Pending Pool 2', capacity: 5 },
    });
    const ticket = await ctx.prisma.ticket.create({
      data: {
        poolId: pool.id,
        jiraKey: 'ENG-11',
        jiraUrl: 'https://example.atlassian.net/browse/ENG-11',
        title: 'No due date ticket, recent',
        deadline: null,
        status: 'Normal',
        addedAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    });

    await ctx.runDeadlineScan();

    const updated = await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(updated.status).toBe('Normal');
  });
});
