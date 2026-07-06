import request from 'supertest';
import { buildTestApp, TestAppContext } from './testApp';

describe('user settings', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await buildTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  const base = () => `http://localhost:${ctx.port}`;

  it('GET returns the default lead time', async () => {
    const res = await request(base()).get('/users/me/settings');
    expect(res.status).toBe(200);
    expect(res.body.defaultWarningLeadMinutes).toBe(60);
  });

  it('rejects 0 as out of range', async () => {
    const res = await request(base()).patch('/users/me/settings').send({ defaultWarningLeadMinutes: 0 });
    expect(res.status).toBe(400);
  });

  it('accepts 121 (no upper bound)', async () => {
    const res = await request(base()).patch('/users/me/settings').send({ defaultWarningLeadMinutes: 121 });
    expect(res.status).toBe(200);
    expect(res.body.defaultWarningLeadMinutes).toBe(121);
  });

  it('accepts large multi-day values', async () => {
    const res = await request(base()).patch('/users/me/settings').send({ defaultWarningLeadMinutes: 4320 });
    expect(res.status).toBe(200);
    expect(res.body.defaultWarningLeadMinutes).toBe(4320);
  });

  it('accepts 90 and round-trips it', async () => {
    const patchRes = await request(base()).patch('/users/me/settings').send({ defaultWarningLeadMinutes: 90 });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.defaultWarningLeadMinutes).toBe(90);

    const getRes = await request(base()).get('/users/me/settings');
    expect(getRes.body.defaultWarningLeadMinutes).toBe(90);
  });

  it('defaults working time to 8:00-17:00, 24h format', async () => {
    const res = await request(base()).get('/users/me/settings');
    expect(res.body.workingHourStart).toBe(480);
    expect(res.body.workingHourEnd).toBe(1020);
    expect(res.body.timeFormat).toBe('24h');
  });

  it('accepts a valid working time range and time format, and round-trips it', async () => {
    const patchRes = await request(base())
      .patch('/users/me/settings')
      .send({ workingHourStart: 540, workingHourEnd: 1080, timeFormat: '12h' });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.workingHourStart).toBe(540);
    expect(patchRes.body.workingHourEnd).toBe(1080);
    expect(patchRes.body.timeFormat).toBe('12h');

    const getRes = await request(base()).get('/users/me/settings');
    expect(getRes.body.workingHourStart).toBe(540);
    expect(getRes.body.workingHourEnd).toBe(1080);
    expect(getRes.body.timeFormat).toBe('12h');
  });

  it('rejects an out-of-range workingHourStart', async () => {
    const res = await request(base()).patch('/users/me/settings').send({ workingHourStart: 1500 });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid timeFormat', async () => {
    const res = await request(base()).patch('/users/me/settings').send({ timeFormat: 'military' });
    expect(res.status).toBe(400);
  });

  it('defaults jiraPollIntervalSeconds to 300', async () => {
    const res = await request(base()).get('/users/me/settings');
    expect(res.body.jiraPollIntervalSeconds).toBe(300);
  });

  it('accepts the minimum jiraPollIntervalSeconds of 15', async () => {
    const res = await request(base()).patch('/users/me/settings').send({ jiraPollIntervalSeconds: 15 });
    expect(res.status).toBe(200);
    expect(res.body.jiraPollIntervalSeconds).toBe(15);
  });

  it('rejects jiraPollIntervalSeconds below the 15s minimum', async () => {
    const res = await request(base()).patch('/users/me/settings').send({ jiraPollIntervalSeconds: 14 });
    expect(res.status).toBe(400);
  });
});
