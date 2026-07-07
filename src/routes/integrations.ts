import { Router } from 'express';
import { env } from '../env';
import { asyncHandler } from '../lib/asyncHandler';
import {
  AppError,
  ElevenLabsApiKeyInvalidError,
  ElevenLabsNotConfiguredError,
  ElevenLabsQuotaExceededError,
  JiraApiTokenInvalidError,
  ValidationError,
} from '../lib/httpError';
import { decrypt, encrypt } from '../lib/tokenCrypto';
import { attachLocalUser, AuthedRequest } from '../middleware/localUser';
import { prisma } from '../prismaClient';
import { getJiraConfig, saveJiraConfig } from '../services/jiraConfigService';
import { getJiraPollStatus } from '../services/jiraPollScanner';
import { buildAuthorizeUrl, consumeState, exchangeCodeForTokens, TokenExchangeResult } from '../services/oauthService';
import { appEvents } from '../lib/appEvents';
import { OAuthProviderKind } from '../types';

const DEFAULT_ELEVENLABS_VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb';

export const integrationsRouter = Router();

interface OnConnectedResult {
  cloudId?: string;
  siteUrl?: string;
  siteName?: string;
}

interface RegisterProviderOptions {
  onConnected?: (tokens: TokenExchangeResult) => Promise<OnConnectedResult>;
  respondHtml?: boolean;
}

function registerProvider(provider: OAuthProviderKind, options: RegisterProviderOptions = {}) {
  integrationsRouter.post(
    `/integrations/${provider}/connect`,
    attachLocalUser,
    asyncHandler(async (req: AuthedRequest, res) => {
      const { url, state } = await buildAuthorizeUrl(provider, req.user!.id);
      res.json({ authorizeUrl: url, state });
    }),
  );

  integrationsRouter.get(
    `/integrations/${provider}/callback`,
    asyncHandler(async (req, res) => {
      const { code, state } = req.query as { code?: string; state?: string };
      if (!code || !state) {
        res.status(400).json({ error: 'MissingCodeOrState' });
        return;
      }
      const { userId } = consumeState(state);
      const tokens = await exchangeCodeForTokens(provider, code);
      const extra = options.onConnected ? await options.onConnected(tokens) : {};

      await prisma.integrationConnection.upsert({
        where: { userId_provider: { userId, provider } },
        update: {
          authTokenEncrypted: encrypt(tokens.accessToken),
          refreshTokenEncrypted: tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
          expiresAt: tokens.expiresInSec ? new Date(Date.now() + tokens.expiresInSec * 1000) : null,
          cloudId: extra.cloudId,
          siteUrl: extra.siteUrl,
          siteName: extra.siteName,
        },
        create: {
          userId,
          provider,
          authTokenEncrypted: encrypt(tokens.accessToken),
          refreshTokenEncrypted: tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
          expiresAt: tokens.expiresInSec ? new Date(Date.now() + tokens.expiresInSec * 1000) : null,
          cloudId: extra.cloudId,
          siteUrl: extra.siteUrl,
          siteName: extra.siteName,
        },
      });

      if (options.respondHtml) {

        appEvents.emit('IntegrationConnected', { provider });
        res.type('html').send(
          `<!doctype html><html><body style="font-family:-apple-system,sans-serif;text-align:center;padding:60px;">` +
            `<h2>Connected to ${provider === 'jira' ? 'Jira' : provider} ✓</h2>` +
            `<p>You can close this tab and return to the app.</p></body></html>`,
        );
        return;
      }

      res.json({ connected: true, provider });
    }),
  );
}

async function discoverJiraSite(tokens: TokenExchangeResult): Promise<OnConnectedResult> {
  const res = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
    headers: { Authorization: `Bearer ${tokens.accessToken}`, Accept: 'application/json' },
  });
  if (!res.ok) return {};
  const resources = (await res.json()) as Array<{ id: string; url: string; name: string }>;

  const site = resources[0];
  if (!site) return {};
  return { cloudId: site.id, siteUrl: site.url, siteName: site.name };
}

registerProvider('jira', { onConnected: discoverJiraSite, respondHtml: true });
registerProvider('notifier');

integrationsRouter.get(
  '/integrations/jira/config',
  attachLocalUser,
  asyncHandler(async (_req, res) => {
    const config = await getJiraConfig();
    res.json({
      clientId: config?.clientId ?? '',
      redirectUri: `http://localhost:${env.PORT}/integrations/jira/callback`,
      configured: !!config,
    });
  }),
);

integrationsRouter.put(
  '/integrations/jira/config',
  attachLocalUser,
  asyncHandler(async (req, res) => {
    const { clientId, clientSecret } = req.body ?? {};
    if (!clientId || !clientSecret) {
      throw new ValidationError('clientId and clientSecret are both required');
    }
    await saveJiraConfig(clientId, clientSecret);
    res.json({ saved: true });
  }),
);

integrationsRouter.get(
  '/integrations/jira/status',
  attachLocalUser,
  asyncHandler(async (req: AuthedRequest, res) => {
    const connection = await prisma.integrationConnection.findUnique({
      where: { userId_provider: { userId: req.user!.id, provider: 'jira' } },
    });
    const pollStatus = getJiraPollStatus();
    const connected = !!connection && (connection.authMethod === 'api_token' ? !!connection.siteUrl : !!connection.cloudId);
    res.json({
      connected,
      authMethod: connection?.authMethod ?? null,
      siteUrl: connection?.siteUrl ?? undefined,
      siteName: connection?.siteName ?? undefined,
      email: connection?.email ?? undefined,
      pollOffline: pollStatus.offline,
      lastPollAttemptAt: pollStatus.lastAttemptAt,
    });
  }),
);

integrationsRouter.put(
  '/integrations/jira/api-token',
  attachLocalUser,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { siteUrl, email, apiToken } = req.body ?? {};
    if (!siteUrl || !email || !apiToken) {
      throw new ValidationError('siteUrl, email and apiToken are all required');
    }
    const normalizedSiteUrl = String(siteUrl).replace(/\/+$/, '');

    const basicAuth = Buffer.from(`${email}:${apiToken}`).toString('base64');
    const verifyRes = await fetch(`${normalizedSiteUrl}/rest/api/3/myself`, {
      headers: { Authorization: `Basic ${basicAuth}`, Accept: 'application/json' },
    });
    if (!verifyRes.ok) throw new JiraApiTokenInvalidError();

    const siteName = new URL(normalizedSiteUrl).hostname.split('.')[0];

    await prisma.integrationConnection.upsert({
      where: { userId_provider: { userId: req.user!.id, provider: 'jira' } },
      update: {
        authMethod: 'api_token',
        authTokenEncrypted: encrypt(apiToken),
        refreshTokenEncrypted: null,
        expiresAt: null,
        cloudId: null,
        siteUrl: normalizedSiteUrl,
        siteName,
        email,
      },
      create: {
        userId: req.user!.id,
        provider: 'jira',
        authMethod: 'api_token',
        authTokenEncrypted: encrypt(apiToken),
        siteUrl: normalizedSiteUrl,
        siteName,
        email,
      },
    });

    appEvents.emit('IntegrationConnected', { provider: 'jira' });
    res.json({ connected: true, provider: 'jira' });
  }),
);

integrationsRouter.get(
  '/integrations/elevenlabs/config',
  attachLocalUser,
  asyncHandler(async (req: AuthedRequest, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    res.json({
      configured: !!user.elevenLabsApiKeyEncrypted,
      voiceId: user.elevenLabsVoiceId || DEFAULT_ELEVENLABS_VOICE_ID,
    });
  }),
);

integrationsRouter.put(
  '/integrations/elevenlabs/config',
  attachLocalUser,
  asyncHandler(async (req: AuthedRequest, res) => {
    const apiKey = String(req.body?.apiKey ?? '').trim();
    const voiceId = String(req.body?.voiceId ?? '').trim();
    if (!apiKey) throw new ValidationError('apiKey is required');

    await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        elevenLabsApiKeyEncrypted: encrypt(apiKey),
        elevenLabsVoiceId: voiceId || DEFAULT_ELEVENLABS_VOICE_ID,
      },
    });

    res.json({ configured: true });
  }),
);

integrationsRouter.post(
  '/integrations/elevenlabs/test',
  attachLocalUser,
  asyncHandler(async (req: AuthedRequest, res) => {
    const apiKey = String(req.body?.apiKey ?? '').trim();
    if (!apiKey) throw new ValidationError('apiKey is required');

    // Scoped API keys (e.g. text_to_speech-only) lack the user_read permission needed
    // for /v1/user, so a real (minimal) TTS call is the only reliable validity check.
    const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${DEFAULT_ELEVENLABS_VOICE_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey },
      body: JSON.stringify({ text: '.', model_id: 'eleven_multilingual_v2' }),
    });

    if (ttsRes.status === 401) {
      const body = (await ttsRes.json().catch(() => null)) as { detail?: { status?: string } } | null;
      if (body?.detail?.status === 'quota_exceeded') throw new ElevenLabsQuotaExceededError();
      throw new ElevenLabsApiKeyInvalidError();
    }
    if (!ttsRes.ok) throw new ElevenLabsApiKeyInvalidError();

    res.json({ valid: true });
  }),
);

integrationsRouter.post(
  '/integrations/elevenlabs/speak',
  attachLocalUser,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { text } = req.body ?? {};
    if (!text) throw new ValidationError('text is required');

    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (!user.elevenLabsApiKeyEncrypted) throw new ElevenLabsNotConfiguredError();

    const apiKey = decrypt(user.elevenLabsApiKeyEncrypted);
    const voiceId = user.elevenLabsVoiceId || DEFAULT_ELEVENLABS_VOICE_ID;

    const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey },
      body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2' }),
    });
    if (ttsRes.status === 401) {
      const body = (await ttsRes.json().catch(() => null)) as { detail?: { status?: string } } | null;
      if (body?.detail?.status === 'quota_exceeded') throw new ElevenLabsQuotaExceededError();
      throw new ElevenLabsApiKeyInvalidError();
    }
    if (!ttsRes.ok) throw new AppError('ElevenLabsSpeakFailed', 502, { status: ttsRes.status });

    const audioBuffer = Buffer.from(await ttsRes.arrayBuffer());
    res.json({ audioUrl: `data:audio/mpeg;base64,${audioBuffer.toString('base64')}` });
  }),
);
