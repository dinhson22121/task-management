import request from 'supertest';
import { buildTestApp, TestAppContext } from './testApp';

describe('Jira API token authentication', () => {
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

  const base = () => `http://localhost:${ctx.port}`;

  it('rejects a request missing required fields', async () => {
    const res = await request(base())
      .put('/integrations/jira/api-token')
      .send({ siteUrl: 'https://example.atlassian.net' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ValidationError');
  });

  it('rejects connecting with invalid credentials', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 }) as unknown as typeof fetch;

    const res = await request(base())
      .put('/integrations/jira/api-token')
      .send({ siteUrl: 'https://example.atlassian.net', email: 'me@example.com', apiToken: 'bad-token' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('JiraApiTokenInvalid');

    const statusRes = await request(base()).get('/integrations/jira/status');
    expect(statusRes.body.connected).toBe(false);
  });

  it('connects successfully and reports status as connected via api_token', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ displayName: 'Test User' }),
    }) as unknown as typeof fetch;

    const connectRes = await request(base())
      .put('/integrations/jira/api-token')
      .send({ siteUrl: 'https://example.atlassian.net/', email: 'me@example.com', apiToken: 'good-token' });

    expect(connectRes.status).toBe(200);
    expect(connectRes.body.connected).toBe(true);

    const statusRes = await request(base()).get('/integrations/jira/status');
    expect(statusRes.body.connected).toBe(true);
    expect(statusRes.body.authMethod).toBe('api_token');
    expect(statusRes.body.siteUrl).toBe('https://example.atlassian.net');
    expect(statusRes.body.email).toBe('me@example.com');
  });

  it('fetches issue fields directly from the site URL with Basic auth when using api_token', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ displayName: 'Test User' }),
    }) as unknown as typeof fetch;
    await request(base())
      .put('/integrations/jira/api-token')
      .send({ siteUrl: 'https://example.atlassian.net', email: 'me@example.com', apiToken: 'good-token' });

    await ctx.prisma.user.update({ where: { id: ctx.userId }, data: { appMode: 'production' } });

    let capturedUrl = '';
    let capturedAuth = '';
    global.fetch = jest.fn().mockImplementation((url: string, opts: { headers: Record<string, string> }) => {
      capturedUrl = url;
      capturedAuth = opts.headers.Authorization;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          fields: { summary: 'Token issue', description: null, duedate: '2026-10-01', status: { name: 'To Do' } },
        }),
      });
    }) as unknown as typeof fetch;

    const poolRes = await request(base()).post('/pools').send({ name: 'API Token Pool', capacity: 5 });
    const addRes = await request(base())
      .post(`/pools/${poolRes.body.id}/tickets`)
      .send({ jiraUrl: 'https://example.atlassian.net/browse/ENG-9001' });

    expect(addRes.status).toBe(201);
    expect(capturedUrl).toBe(
      'https://example.atlassian.net/rest/api/3/issue/ENG-9001?fields=summary,description,duedate,status',
    );
    expect(capturedAuth).toBe('Basic ' + Buffer.from('me@example.com:good-token').toString('base64'));
    expect(addRes.body.jiraStatus).toBe('To Do');
  });
});
