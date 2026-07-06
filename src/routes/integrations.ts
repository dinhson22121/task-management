import { Router } from 'express';
import { env } from '../env';
import { asyncHandler } from '../lib/asyncHandler';
import { ValidationError } from '../lib/httpError';
import { encrypt } from '../lib/tokenCrypto';
import { attachLocalUser, AuthedRequest } from '../middleware/localUser';
import { prisma } from '../prismaClient';
import { getJiraConfig, saveJiraConfig } from '../services/jiraConfigService';
import { getJiraPollStatus } from '../services/jiraPollScanner';
import { buildAuthorizeUrl, consumeState, exchangeCodeForTokens, TokenExchangeResult } from '../services/oauthService';
import { getIo } from '../sockets/ioInstance';
import { OAuthProviderKind } from '../types';

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

        getIo()?.emit('IntegrationConnected', { provider });
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
    res.json({
      connected: !!connection?.cloudId,
      siteUrl: connection?.siteUrl ?? undefined,
      siteName: connection?.siteName ?? undefined,
      pollOffline: pollStatus.offline,
      lastPollAttemptAt: pollStatus.lastAttemptAt,
    });
  }),
);
