import { encrypt } from '../lib/tokenCrypto';
import { buildTestApp, TestAppContext } from './testApp';

describe('Jira poll scanner', () => {
  let ctx: TestAppContext;
  let originalFetch: typeof fetch;

  beforeAll(async () => {
    ctx = await buildTestApp();
    originalFetch = global.fetch;
  });

  afterAll(async () => {
    global.fetch = originalFetch;
    await ctx.close();
  });

  afterEach(async () => {
    await ctx.prisma.user.update({ where: { id: ctx.userId }, data: { appMode: 'demo' } });
    await ctx.prisma.integrationConnection.deleteMany({ where: { userId: ctx.userId } });
  });

  async function connectJira() {
    await ctx.prisma.user.update({
      where: { id: ctx.userId },
      data: { appMode: 'production', workingHourEnd: 1020 },
    });
    await ctx.prisma.integrationConnection.upsert({
      where: { userId_provider: { userId: ctx.userId, provider: 'jira' } },
      create: {
        userId: ctx.userId,
        provider: 'jira',
        authTokenEncrypted: Buffer.from(encrypt('fake-token')),
        cloudId: 'fake-cloud-id',
        siteUrl: 'https://example.atlassian.net',
        siteName: 'example',
      },
      update: {
        authTokenEncrypted: Buffer.from(encrypt('fake-token')),
        cloudId: 'fake-cloud-id',
      },
    });
  }

  async function makeTicket(jiraKey: string, deadline: Date) {
    const pool = await ctx.prisma.pool.create({
      data: { ownerId: ctx.userId, name: `Pool-${jiraKey}`, capacity: 5 },
    });
    return ctx.prisma.ticket.create({
      data: {
        poolId: pool.id,
        jiraKey,
        jiraUrl: `https://example.atlassian.net/browse/${jiraKey}`,
        title: `Ticket ${jiraKey}`,
        deadline,
        status: 'Normal',
      },
    });
  }

  function mockJiraIssue(duedate: string | null, statusCategoryKey: string) {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ fields: { summary: 'x', description: null, duedate, status: { statusCategory: { key: statusCategoryKey } } } }),
    }) as unknown as typeof fetch;
  }

  it('updates the deadline when the Jira due date changed', async () => {
    await connectJira();
    const ticket = await makeTicket('POLL-1', new Date('2026-01-01T17:00:00'));
    mockJiraIssue('2026-02-01', 'indeterminate');

    await ctx.runJiraPollScan();

    const updated = await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(updated.deadline.getMonth()).toBe(1);
    expect(updated.deadline.getDate()).toBe(1);
    expect(updated.deadline.getHours()).toBe(17);
  });

  it('marks the ticket Done when Jira reports the done status category', async () => {
    await connectJira();
    const deadline = new Date('2026-03-01T17:00:00');
    const ticket = await makeTicket('POLL-2', deadline);
    mockJiraIssue('2026-03-01', 'done');

    await ctx.runJiraPollScan();

    const updated = await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(updated.status).toBe('Done');
    expect(updated.doneAt).not.toBeNull();
  });

  it('does not mark the ticket Done for a non-done status category', async () => {
    await connectJira();
    const deadline = new Date('2026-03-01T17:00:00');
    const ticket = await makeTicket('POLL-3', deadline);
    mockJiraIssue('2026-03-01', 'indeterminate');

    await ctx.runJiraPollScan();

    const updated = await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(updated.status).not.toBe('Done');
  });

  it('skips tickets owned by a demo-mode user without calling Jira', async () => {
    const ticket = await makeTicket('POLL-4', new Date('2026-01-01T17:00:00'));
    global.fetch = jest.fn() as unknown as typeof fetch;

    await ctx.runJiraPollScan();

    expect(global.fetch).not.toHaveBeenCalled();
    const unchanged = await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(unchanged.deadline).toEqual(new Date('2026-01-01T17:00:00'));
  });

  it('skips a production-mode ticket gracefully when Jira is not connected', async () => {
    await ctx.prisma.user.update({ where: { id: ctx.userId }, data: { appMode: 'production' } });
    const ticket = await makeTicket('POLL-5', new Date('2026-01-01T17:00:00'));

    await expect(ctx.runJiraPollScan()).resolves.toBeUndefined();

    const unchanged = await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(unchanged.status).toBe('Normal');
  });

  it('continues scanning remaining tickets when one fetch fails', async () => {
    await connectJira();
    const failing = await makeTicket('POLL-FAIL', new Date('2026-01-01T17:00:00'));
    const okTicket = await makeTicket('POLL-OK', new Date('2026-01-01T17:00:00'));

    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes('POLL-FAIL')) return Promise.reject(new TypeError('fetch failed'));
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ fields: { summary: 'x', description: null, duedate: '2026-04-01', status: { statusCategory: { key: 'indeterminate' } } } }),
      });
    }) as unknown as typeof fetch;

    await expect(ctx.runJiraPollScan()).resolves.toBeUndefined();

    const okUpdated = await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: okTicket.id } });
    expect(okUpdated.deadline.getMonth()).toBe(3);

    const failingUnchanged = await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: failing.id } });
    expect(failingUnchanged.deadline).toEqual(new Date('2026-01-01T17:00:00'));
  });

  it('reports offline when every fetch fails with a network error', async () => {
    await connectJira();
    await makeTicket('POLL-OFFLINE-1', new Date('2026-01-01T17:00:00'));
    await makeTicket('POLL-OFFLINE-2', new Date('2026-01-01T17:00:00'));

    global.fetch = jest.fn().mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof fetch;

    await ctx.runJiraPollScan();

    expect(ctx.getJiraPollStatus().offline).toBe(true);
  });

  it('reports online when at least one ticket is fetched successfully', async () => {
    await connectJira();
    await makeTicket('POLL-ONLINE-1', new Date('2026-01-01T17:00:00'));
    mockJiraIssue('2026-05-01', 'indeterminate');

    await ctx.runJiraPollScan();

    expect(ctx.getJiraPollStatus().offline).toBe(false);
  });
});
