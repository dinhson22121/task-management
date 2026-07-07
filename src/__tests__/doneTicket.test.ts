import request from 'supertest';
import { buildTestApp, TestAppContext } from './testApp';

describe('Done / Remove ticket flow', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await buildTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  const base = () => `http://localhost:${ctx.port}`;

  async function makePoolWithTicket(capacity: number, jiraKey: string) {
    const pool = await ctx.prisma.pool.create({
      data: { ownerId: ctx.userId, name: `Pool-${Date.now()}-${jiraKey}`, capacity },
    });
    const ticket = await ctx.prisma.ticket.create({
      data: {
        poolId: pool.id,
        jiraKey,
        jiraUrl: `https://example.atlassian.net/browse/${jiraKey}`,
        title: `Ticket ${jiraKey}`,
        deadline: new Date(Date.now() + 60 * 60 * 1000),
        status: 'Normal',
      },
    });
    return { pool, ticket };
  }

  it('marking a ticket Done keeps it in the active list and still counts toward capacity today', async () => {
    const { pool, ticket } = await makePoolWithTicket(1, 'ENG-1001');

    const doneRes = await request(base()).post(`/pools/${pool.id}/tickets/${ticket.id}/done`);
    expect(doneRes.status).toBe(200);
    expect(doneRes.body.status).toBe('Done');

    const listRes = await request(base()).get(`/pools/${pool.id}/tickets`);
    expect(listRes.body.some((t: { id: string }) => t.id === ticket.id)).toBe(true);

    const addRes = await request(base())
      .post(`/pools/${pool.id}/tickets`)
      .send({ jiraUrl: 'https://example.atlassian.net/browse/ENG-1002' });
    expect(addRes.status).toBe(409);
    expect(addRes.body.error).toBe('PoolCapacityExceeded');
  });

  it('a ticket Done on a previous day drops out of the active list, frees capacity, and appears in the Done list', async () => {
    const { pool, ticket } = await makePoolWithTicket(1, 'ENG-2001');

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await ctx.prisma.ticket.update({ where: { id: ticket.id }, data: { status: 'Done', doneAt: yesterday } });

    const listRes = await request(base()).get(`/pools/${pool.id}/tickets`);
    expect(listRes.body.some((t: { id: string }) => t.id === ticket.id)).toBe(false);

    const addRes = await request(base())
      .post(`/pools/${pool.id}/tickets`)
      .send({ jiraUrl: 'https://example.atlassian.net/browse/ENG-2002' });
    expect(addRes.status).toBe(201);

    const doneListRes = await request(base()).get(`/pools/${pool.id}/tickets/done`);
    expect(doneListRes.body.some((t: { id: string }) => t.id === ticket.id)).toBe(true);
  });

  it('Done list search filters by ticket key prefix', async () => {
    const { pool, ticket } = await makePoolWithTicket(5, 'ABC-3001');
    await ctx.prisma.ticket.update({ where: { id: ticket.id }, data: { status: 'Done', doneAt: new Date() } });

    const matchRes = await request(base()).get(`/pools/${pool.id}/tickets/done`).query({ search: 'ABC' });
    expect(matchRes.body.some((t: { id: string }) => t.id === ticket.id)).toBe(true);

    const noMatchRes = await request(base()).get(`/pools/${pool.id}/tickets/done`).query({ search: 'ZZZ' });
    expect(noMatchRes.body.some((t: { id: string }) => t.id === ticket.id)).toBe(false);
  });

  it('removing a ticket deletes it immediately and frees capacity right away', async () => {
    const { pool, ticket } = await makePoolWithTicket(1, 'ENG-4001');

    const delRes = await request(base()).delete(`/pools/${pool.id}/tickets/${ticket.id}`);
    expect(delRes.status).toBe(204);

    const addRes = await request(base())
      .post(`/pools/${pool.id}/tickets`)
      .send({ jiraUrl: 'https://example.atlassian.net/browse/ENG-4002' });
    expect(addRes.status).toBe(201);
  });

  it('undoing a Done ticket restores it to Normal (mis-click recovery)', async () => {
    const { pool, ticket } = await makePoolWithTicket(5, 'ENG-5001');
    await request(base()).post(`/pools/${pool.id}/tickets/${ticket.id}/done`);

    const undoRes = await request(base()).post(`/pools/${pool.id}/tickets/${ticket.id}/undo`);
    expect(undoRes.status).toBe(200);
    expect(undoRes.body.status).toBe('Normal');
    expect(undoRes.body.doneAt).toBeNull();

    const listRes = await request(base()).get(`/pools/${pool.id}/tickets`);
    expect(listRes.body.some((t: { id: string; status: string }) => t.id === ticket.id && t.status === 'Normal')).toBe(true);
  });

  it('undoing a Done ticket whose deadline already passed restores it to Overdue', async () => {
    const pool = await ctx.prisma.pool.create({ data: { ownerId: ctx.userId, name: 'Overdue Undo Pool', capacity: 5 } });
    const ticket = await ctx.prisma.ticket.create({
      data: {
        poolId: pool.id,
        jiraKey: 'ENG-5002',
        jiraUrl: 'https://example.atlassian.net/browse/ENG-5002',
        title: 'Overdue ticket',
        deadline: new Date(Date.now() - 60 * 60 * 1000),
        status: 'Done',
        doneAt: new Date(),
      },
    });

    const undoRes = await request(base()).post(`/pools/${pool.id}/tickets/${ticket.id}/undo`);
    expect(undoRes.status).toBe(200);
    expect(undoRes.body.status).toBe('Overdue');
  });

  it('rejects undo when the pool is already full', async () => {
    const { pool, ticket } = await makePoolWithTicket(1, 'ENG-5003');
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await ctx.prisma.ticket.update({ where: { id: ticket.id }, data: { status: 'Done', doneAt: yesterday } });

    await request(base())
      .post(`/pools/${pool.id}/tickets`)
      .send({ jiraUrl: 'https://example.atlassian.net/browse/ENG-5004' });

    const undoRes = await request(base()).post(`/pools/${pool.id}/tickets/${ticket.id}/undo`);
    expect(undoRes.status).toBe(409);
    expect(undoRes.body.error).toBe('PoolCapacityExceeded');
  });

  it('removing an already-Done ticket from the active view keeps it in the Done list and frees capacity', async () => {
    const { pool, ticket } = await makePoolWithTicket(1, 'ENG-6001');
    await request(base()).post(`/pools/${pool.id}/tickets/${ticket.id}/done`);

    const delRes = await request(base()).delete(`/pools/${pool.id}/tickets/${ticket.id}`);
    expect(delRes.status).toBe(204);

    const listRes = await request(base()).get(`/pools/${pool.id}/tickets`);
    expect(listRes.body.some((t: { id: string }) => t.id === ticket.id)).toBe(false);

    const doneListRes = await request(base()).get(`/pools/${pool.id}/tickets/done`);
    expect(doneListRes.body.some((t: { id: string }) => t.id === ticket.id)).toBe(true);

    const addRes = await request(base())
      .post(`/pools/${pool.id}/tickets`)
      .send({ jiraUrl: 'https://example.atlassian.net/browse/ENG-6002' });
    expect(addRes.status).toBe(201);
  });

  it('soft-deleting a Done ticket from the Done page removes it from the Done list immediately', async () => {
    const { pool, ticket } = await makePoolWithTicket(5, 'ENG-7001');
    await request(base()).post(`/pools/${pool.id}/tickets/${ticket.id}/done`);

    const delRes = await request(base()).delete(`/pools/${pool.id}/tickets/${ticket.id}/done`);
    expect(delRes.status).toBe(204);

    const doneListRes = await request(base()).get(`/pools/${pool.id}/tickets/done`);
    expect(doneListRes.body.some((t: { id: string }) => t.id === ticket.id)).toBe(false);
  });

  it('rejects soft-delete on a ticket that is not Done', async () => {
    const { pool, ticket } = await makePoolWithTicket(5, 'ENG-7002');

    const delRes = await request(base()).delete(`/pools/${pool.id}/tickets/${ticket.id}/done`);
    expect(delRes.status).toBe(400);
  });
});
