import request from 'supertest';
import { buildTestApp, TestAppContext } from './testApp';

describe('implicit local user', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await buildTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('a previously-protected route works with zero auth headers', async () => {
    const res = await request(`http://localhost:${ctx.port}`).get('/users/me/settings');
    expect(res.status).toBe(200);
    expect(res.body.defaultWarningLeadMinutes).toBe(60);
  });

  it('every request resolves to the same single cached user, not a fresh upsert per call', async () => {
    const base = `http://localhost:${ctx.port}`;
    await request(base).get('/users/me/settings');
    await request(base).get('/pools');

    const users = await ctx.prisma.user.findMany();
    expect(users).toHaveLength(1);
    expect(users[0].id).toBe(ctx.userId);
  });
});
