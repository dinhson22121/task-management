import { buildTestApp, TestAppContext } from './testApp';

describe('schema smoke test', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await buildTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('creates all 5 tables from the Prisma schema', async () => {
    const rows = await ctx.prisma.$queryRawUnsafe<Array<{ name: string }>>(
      "SELECT name FROM sqlite_master WHERE type='table'",
    );
    const names = rows.map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining(['User', 'Pool', 'Ticket', 'IntegrationConnection', 'NotificationEvent']),
    );
  });
});
