import request from 'supertest';
import { buildTestApp, TestAppContext } from './testApp';

describe('pools CRUD', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await buildTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  const base = () => `http://localhost:${ctx.port}`;

  it('creates, gets, patches a pool, and lists tickets with computed status', async () => {
    const createRes = await request(base()).post('/pools').send({ name: 'Sprint 24', capacity: 10 });
    expect(createRes.status).toBe(201);
    const poolId = createRes.body.id;

    const getRes = await request(base()).get(`/pools/${poolId}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body).toMatchObject({ name: 'Sprint 24', capacity: 10, ticketCount: 0 });

    const patchRes = await request(base())
      .patch(`/pools/${poolId}`)
      .send({ name: 'Sprint 24 Renamed', capacity: 12 });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body).toMatchObject({ name: 'Sprint 24 Renamed', capacity: 12 });

    const addRes = await request(base())
      .post(`/pools/${poolId}/tickets`)
      .send({ jiraUrl: 'https://example.atlassian.net/browse/ENG-100' });
    expect(addRes.status).toBe(201);

    const ticketsRes = await request(base()).get(`/pools/${poolId}/tickets`);
    expect(ticketsRes.status).toBe(200);
    expect(ticketsRes.body).toHaveLength(1);
    expect(ticketsRes.body[0].status).toBe('Normal');
    expect(ticketsRes.body[0].jiraKey).toBe('ENG-100');
  });

  it('lists pools for the current user via GET /pools', async () => {
    await request(base()).post('/pools').send({ name: 'Bugfix Queue', capacity: 5 });

    const listRes = await request(base()).get('/pools');
    expect(listRes.status).toBe(200);
    expect(listRes.body.length).toBeGreaterThanOrEqual(1);
    expect(listRes.body[0]).toHaveProperty('ticketCount');
  });

  it('rejects invalid capacity', async () => {
    const res = await request(base()).post('/pools').send({ name: 'Bad Pool', capacity: 0 });
    expect(res.status).toBe(400);
  });

  it('accepts an optional note when adding a ticket, and allows editing it later', async () => {
    const poolRes = await request(base()).post('/pools').send({ name: 'Note Pool', capacity: 5 });
    const poolId = poolRes.body.id;

    const addRes = await request(base())
      .post(`/pools/${poolId}/tickets`)
      .send({ jiraUrl: 'https://example.atlassian.net/browse/ENG-200', note: 'Waiting on design review' });
    expect(addRes.status).toBe(201);
    expect(addRes.body.note).toBe('Waiting on design review');

    const patchRes = await request(base())
      .patch(`/pools/${poolId}/tickets/${addRes.body.id}`)
      .send({ note: 'Design review done, ready to ship' });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.note).toBe('Design review done, ready to ship');
  });

  it('defaults note to null when not provided', async () => {
    const poolRes = await request(base()).post('/pools').send({ name: 'No Note Pool', capacity: 5 });
    const addRes = await request(base())
      .post(`/pools/${poolRes.body.id}/tickets`)
      .send({ jiraUrl: 'https://example.atlassian.net/browse/ENG-201' });
    expect(addRes.status).toBe(201);
    expect(addRes.body.note).toBeNull();
  });
});
