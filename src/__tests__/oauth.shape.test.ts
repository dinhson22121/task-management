import request from 'supertest';
import { encrypt } from '../lib/tokenCrypto';
import { buildTestApp, TestAppContext } from './testApp';

describe('OAuth connect endpoints (shape only, no real provider available)', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await buildTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('POST /integrations/jira/connect returns 400 JiraNotConfigured with no saved credentials', async () => {
    const res = await request(`http://localhost:${ctx.port}`).post('/integrations/jira/connect');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('JiraNotConfigured');
  });

  it('POST /integrations/jira/connect returns a well-formed authorize URL once configured', async () => {
    await ctx.prisma.jiraConfig.create({
      data: { id: 'singleton', clientId: 'test-client-id', clientSecretEncrypted: Buffer.from(encrypt('test-secret')) },
    });

    const res = await request(`http://localhost:${ctx.port}`).post('/integrations/jira/connect');

    expect(res.status).toBe(200);
    expect(res.body.state).toBeTruthy();

    const url = new URL(res.body.authorizeUrl);
    expect(url.searchParams.get('client_id')).toBe('test-client-id');
    expect(url.searchParams.get('redirect_uri')).not.toBeNull();
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe(res.body.state);
    expect(url.searchParams.get('scope')).toBe('read:jira-work offline_access');
    expect(url.searchParams.get('audience')).toBe('api.atlassian.com');

    await ctx.prisma.jiraConfig.delete({ where: { id: 'singleton' } });
  });

  it('POST /integrations/notifier/connect returns a well-formed authorize URL', async () => {
    const res = await request(`http://localhost:${ctx.port}`).post('/integrations/notifier/connect');

    expect(res.status).toBe(200);
    const url = new URL(res.body.authorizeUrl);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBeTruthy();
  });
});
