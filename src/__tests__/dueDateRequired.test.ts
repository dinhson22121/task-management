import request from 'supertest';
import { encrypt } from '../lib/tokenCrypto';
import { buildTestApp, TestAppContext } from './testApp';

describe('Production mode: missing Jira due date is blocked', () => {
  let ctx: TestAppContext;
  let originalFetch: typeof fetch;

  beforeAll(async () => {
    ctx = await buildTestApp();
    originalFetch = global.fetch;

    await ctx.prisma.user.update({ where: { id: ctx.userId }, data: { appMode: 'production' } });
    await ctx.prisma.integrationConnection.create({
      data: {
        userId: ctx.userId,
        provider: 'jira',
        authTokenEncrypted: Buffer.from(encrypt('fake-token')),
        cloudId: 'fake-cloud-id',
        siteUrl: 'https://example.atlassian.net',
        siteName: 'example',
      },
    });
  });

  afterAll(async () => {
    global.fetch = originalFetch;
    await ctx.close();
  });

  const base = () => `http://localhost:${ctx.port}`;

  function mockJiraIssue(duedate: string | null, statusName?: string) {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        fields: { summary: 'Real issue', description: null, duedate, status: statusName ? { name: statusName } : undefined },
      }),
    }) as unknown as typeof fetch;
  }

  it('blocks adding a ticket when the Jira issue has no due date and none is supplied', async () => {
    mockJiraIssue(null);
    const pool = await ctx.prisma.pool.create({ data: { ownerId: ctx.userId, name: 'No Due Date Pool', capacity: 5 } });

    const res = await request(base())
      .post(`/pools/${pool.id}/tickets`)
      .send({ jiraUrl: 'https://example.atlassian.net/browse/ENG-5001' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('DueDateRequired');
  });

  it('allows adding without a due date when confirmed, leaving deadline null but setting jiraStatus immediately', async () => {
    mockJiraIssue(null, 'In Progress');
    const pool = await ctx.prisma.pool.create({ data: { ownerId: ctx.userId, name: 'Confirmed No Due Date Pool', capacity: 5 } });

    const res = await request(base())
      .post(`/pools/${pool.id}/tickets`)
      .send({ jiraUrl: 'https://example.atlassian.net/browse/ENG-5004', confirmNoDueDate: true });

    expect(res.status).toBe(201);
    expect(res.body.deadline).toBeNull();
    expect(res.body.status).toBe('Normal');
    expect(res.body.jiraStatus).toBe('In Progress');
  });

  it('accepts a manually supplied due date, combined with the working hour end', async () => {
    mockJiraIssue(null);
    await ctx.prisma.user.update({ where: { id: ctx.userId }, data: { workingHourEnd: 1020 } });
    const pool = await ctx.prisma.pool.create({ data: { ownerId: ctx.userId, name: 'Manual Due Date Pool', capacity: 5 } });

    const res = await request(base())
      .post(`/pools/${pool.id}/tickets`)
      .send({ jiraUrl: 'https://example.atlassian.net/browse/ENG-5002', dueDate: '2026-08-01' });

    expect(res.status).toBe(201);
    const deadline = new Date(res.body.deadline);
    expect(deadline.getHours()).toBe(17);
  });

  it('uses the real Jira due date (combined with working hour end) when present, ignoring any manual date', async () => {
    mockJiraIssue('2026-09-15');
    const pool = await ctx.prisma.pool.create({ data: { ownerId: ctx.userId, name: 'Real Due Date Pool', capacity: 5 } });

    const res = await request(base())
      .post(`/pools/${pool.id}/tickets`)
      .send({ jiraUrl: 'https://example.atlassian.net/browse/ENG-5003' });

    expect(res.status).toBe(201);
    const deadline = new Date(res.body.deadline);
    expect(deadline.getDate()).toBe(15);
    expect(deadline.getHours()).toBe(17);
  });
});
