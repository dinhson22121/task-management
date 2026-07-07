import { buildTestApp, TestAppContext } from './testApp';

describe('ticket retention scanner', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await buildTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('purges soft-deleted tickets past the 30-day TTL but keeps recently soft-deleted ones', async () => {
    const pool = await ctx.prisma.pool.create({ data: { ownerId: ctx.userId, name: 'Trash Pool', capacity: 5 } });
    const oldDeleted = await ctx.prisma.ticket.create({
      data: {
        poolId: pool.id,
        jiraKey: 'ENG-8001',
        jiraUrl: 'https://example.atlassian.net/browse/ENG-8001',
        title: 'Old trashed ticket',
        status: 'Done',
        doneAt: new Date(),
        deletedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
      },
    });
    const recentDeleted = await ctx.prisma.ticket.create({
      data: {
        poolId: pool.id,
        jiraKey: 'ENG-8002',
        jiraUrl: 'https://example.atlassian.net/browse/ENG-8002',
        title: 'Recently trashed ticket',
        status: 'Done',
        doneAt: new Date(),
        deletedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      },
    });

    await ctx.purgeExpiredTrash();

    const oldExists = await ctx.prisma.ticket.findUnique({ where: { id: oldDeleted.id } });
    const recentExists = await ctx.prisma.ticket.findUnique({ where: { id: recentDeleted.id } });
    expect(oldExists).toBeNull();
    expect(recentExists).not.toBeNull();
  });

  it('does not touch tickets that were never soft-deleted', async () => {
    const pool = await ctx.prisma.pool.create({ data: { ownerId: ctx.userId, name: 'Trash Pool 2', capacity: 5 } });
    const ticket = await ctx.prisma.ticket.create({
      data: {
        poolId: pool.id,
        jiraKey: 'ENG-8003',
        jiraUrl: 'https://example.atlassian.net/browse/ENG-8003',
        title: 'Untouched ticket',
        status: 'Done',
        doneAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      },
    });

    await ctx.purgeExpiredTrash();

    const exists = await ctx.prisma.ticket.findUnique({ where: { id: ticket.id } });
    expect(exists).not.toBeNull();
  });
});
