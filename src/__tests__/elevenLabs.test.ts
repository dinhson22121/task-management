import request from 'supertest';
import { buildTestApp, TestAppContext } from './testApp';

describe('ElevenLabs voice provider', () => {
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

  const base = () => `http://localhost:${ctx.port}`;

  it('GET config reports not configured with the default voice id when nothing is saved', async () => {
    const res = await request(base()).get('/integrations/elevenlabs/config');
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
    expect(res.body.voiceId).toBe('JBFqnCBsd6RMkjVDRZzb');
  });

  it('speak rejects a request missing text', async () => {
    const res = await request(base()).post('/integrations/elevenlabs/speak').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ValidationError');
  });

  it('speak returns 400 when no API key has been saved yet', async () => {
    const res = await request(base()).post('/integrations/elevenlabs/speak').send({ text: 'xin chào' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ElevenLabsNotConfigured');
  });

  it('rejects saving without an apiKey', async () => {
    const res = await request(base()).put('/integrations/elevenlabs/config').send({});
    expect(res.status).toBe(400);
  });

  it('test connection rejects an invalid apiKey without saving anything', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ detail: { status: 'invalid_api_key' } }),
    }) as unknown as typeof fetch;

    const res = await request(base()).post('/integrations/elevenlabs/test').send({ apiKey: 'bad-key' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('ElevenLabsApiKeyInvalid');

    const getRes = await request(base()).get('/integrations/elevenlabs/config');
    expect(getRes.body.configured).toBe(false);
  });

  it('test connection reports quota-exceeded distinctly from an invalid key', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ detail: { status: 'quota_exceeded' } }),
    }) as unknown as typeof fetch;

    const res = await request(base()).post('/integrations/elevenlabs/test').send({ apiKey: 'scoped-key-out-of-credits' });
    expect(res.status).toBe(402);
    expect(res.body.error).toBe('ElevenLabsQuotaExceeded');
  });

  it('test connection reports valid for a working apiKey (even without user_read permission) without saving it', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as unknown as typeof fetch;

    const res = await request(base()).post('/integrations/elevenlabs/test').send({ apiKey: 'good-key' });
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);

    const getRes = await request(base()).get('/integrations/elevenlabs/config');
    expect(getRes.body.configured).toBe(false);
  });

  it('trims whitespace and saves apiKey and custom voiceId without calling out to ElevenLabs, then reports configured', async () => {
    global.fetch = jest.fn(() => {
      throw new Error('save should not call ElevenLabs');
    }) as unknown as typeof fetch;

    const putRes = await request(base())
      .put('/integrations/elevenlabs/config')
      .send({ apiKey: '  good-key  ', voiceId: '  custom-voice-id  ' });
    expect(putRes.status).toBe(200);
    expect(putRes.body.configured).toBe(true);

    const getRes = await request(base()).get('/integrations/elevenlabs/config');
    expect(getRes.body.configured).toBe(true);
    expect(getRes.body.voiceId).toBe('custom-voice-id');
  });

  it('speak returns 402 ElevenLabsQuotaExceeded when the account is out of credits', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ detail: { status: 'quota_exceeded', message: 'out of credits' } }),
    }) as unknown as typeof fetch;

    const res = await request(base()).post('/integrations/elevenlabs/speak').send({ text: 'xin chào' });
    expect(res.status).toBe(402);
    expect(res.body.error).toBe('ElevenLabsQuotaExceeded');
  });

  it('speak calls the TTS endpoint with the saved voiceId and returns a base64 audio data URL', async () => {
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};
    global.fetch = jest.fn().mockImplementation((url: string, opts: { headers: Record<string, string> }) => {
      capturedUrl = url;
      capturedHeaders = opts.headers;
      return Promise.resolve({
        ok: true,
        status: 200,
        arrayBuffer: async () => Buffer.from('fake-audio-bytes').buffer,
      });
    }) as unknown as typeof fetch;

    const res = await request(base()).post('/integrations/elevenlabs/speak').send({ text: 'xin chào' });
    expect(res.status).toBe(200);
    expect(capturedUrl).toBe('https://api.elevenlabs.io/v1/text-to-speech/custom-voice-id');
    expect(capturedHeaders['xi-api-key']).toBe('good-key');
    expect(res.body.audioUrl).toMatch(/^data:audio\/mpeg;base64,/);
  });
});
