import request from 'supertest';
import { buildTestApp, TestAppContext } from './testApp';

describe('Demo/Production app mode', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await buildTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  const base = () => `http://localhost:${ctx.port}`;

  it('defaults to demo mode, and adding a ticket succeeds via mock with zero Jira setup', async () => {
    const settingsRes = await request(base()).get('/users/me/settings');
    expect(settingsRes.body.appMode).toBe('demo');

    const poolRes = await request(base()).post('/pools').send({ name: 'Demo Mode Pool', capacity: 5 });
    const addRes = await request(base())
      .post(`/pools/${poolRes.body.id}/tickets`)
      .send({ jiraUrl: 'https://example.atlassian.net/browse/ENG-900' });
    expect(addRes.status).toBe(201);
    expect(addRes.body.title).toBe('Mock title for ENG-900');
  });

  it('switching to production mode is never blocked by whether Jira happens to be connected', async () => {
    const res = await request(base()).patch('/users/me/settings').send({ appMode: 'production' });
    expect(res.status).toBe(200);
    expect(res.body.appMode).toBe('production');
  });

  it('rejects an invalid appMode value', async () => {
    const res = await request(base()).patch('/users/me/settings').send({ appMode: 'staging' });
    expect(res.status).toBe(400);
  });

  it('in production mode with no Jira connection, adding a ticket returns 409 JiraNotConnected', async () => {
    await request(base()).patch('/users/me/settings').send({ appMode: 'production' });

    const poolRes = await request(base()).post('/pools').send({ name: 'Production Mode Pool', capacity: 5 });
    const addRes = await request(base())
      .post(`/pools/${poolRes.body.id}/tickets`)
      .send({ jiraUrl: 'https://example.atlassian.net/browse/ENG-901' });

    expect(addRes.status).toBe(409);
    expect(addRes.body.error).toBe('JiraNotConnected');

    await request(base()).patch('/users/me/settings').send({ appMode: 'demo' });
  });
});
