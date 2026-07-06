import request from 'supertest';
import { buildTestApp, TestAppContext } from './testApp';

describe('pool capacity race', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await buildTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('allows exactly one of two concurrent adds when only one slot remains', async () => {
    const base = `http://localhost:${ctx.port}`;

    const poolRes = await request(base).post('/pools').send({ name: 'Race Pool', capacity: 2 });
    expect(poolRes.status).toBe(201);
    const poolId = poolRes.body.id;

    const fillRes = await request(base)
      .post(`/pools/${poolId}/tickets`)
      .send({ jiraUrl: 'https://example.atlassian.net/browse/ENG-0' });
    expect(fillRes.status).toBe(201);

    const [r1, r2] = await Promise.all([
      request(base).post(`/pools/${poolId}/tickets`).send({ jiraUrl: 'https://example.atlassian.net/browse/ENG-1' }),
      request(base).post(`/pools/${poolId}/tickets`).send({ jiraUrl: 'https://example.atlassian.net/browse/ENG-2' }),
    ]);

    const statuses = [r1.status, r2.status].sort((a, b) => a - b);
    expect(statuses).toEqual([201, 409]);

    const failed = r1.status === 409 ? r1 : r2;
    expect(failed.body).toEqual({ error: 'PoolCapacityExceeded', capacity: 2, current: 2 });

    const listRes = await request(base).get(`/pools/${poolId}/tickets`);
    expect(listRes.body).toHaveLength(2);
  });
});
