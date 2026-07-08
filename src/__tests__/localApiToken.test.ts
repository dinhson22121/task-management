import request from 'supertest';
import { buildTestApp, TestAppContext } from './testApp';

describe('local API token auth', () => {
  let ctx: TestAppContext;
  const TOKEN = 'test-shared-secret';

  beforeAll(async () => {
    process.env.LOCAL_API_TOKEN = TOKEN;
    ctx = await buildTestApp();
  });

  afterAll(async () => {
    delete process.env.LOCAL_API_TOKEN;
    await ctx.close();
  });

  const base = () => `http://localhost:${ctx.port}`;

  it('rejects requests with no token when one is configured', async () => {
    const res = await request(base()).get('/pools');
    expect(res.status).toBe(401);
  });

  it('rejects requests with the wrong token', async () => {
    const res = await request(base()).get('/pools').set('x-local-api-token', 'wrong');
    expect(res.status).toBe(401);
  });

  it('allows requests carrying the correct token', async () => {
    const res = await request(base()).get('/pools').set('x-local-api-token', TOKEN);
    expect(res.status).toBe(200);
  });

  it('leaves /health reachable without a token', async () => {
    const res = await request(base()).get('/health');
    expect(res.status).toBe(200);
  });
});
