import { randomUUID } from 'crypto';
import { env } from '../env';
import { AppError, JiraNotConfiguredError } from '../lib/httpError';
import { getJiraConfig } from './jiraConfigService';
import { OAuthProviderKind } from '../types';

interface ProviderConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authorizeUrl: string;
  tokenUrl: string;
  scope?: string;
  audience?: string;
  extraAuthorizeParams?: Record<string, string>;
}

async function configFor(provider: OAuthProviderKind): Promise<ProviderConfig> {
  if (provider === 'jira') {
    const jiraConfig = await getJiraConfig();
    if (!jiraConfig) throw new JiraNotConfiguredError();
    return {
      clientId: jiraConfig.clientId,
      clientSecret: jiraConfig.clientSecret,

      redirectUri: `http://localhost:${env.PORT}/integrations/jira/callback`,
      authorizeUrl: env.JIRA_AUTHORIZE_URL,
      tokenUrl: env.JIRA_TOKEN_URL,

      scope: 'read:jira-work offline_access',
      audience: 'api.atlassian.com',
      extraAuthorizeParams: { prompt: 'consent' },
    };
  }
  return {
    clientId: env.NOTIFIER_CLIENT_ID,
    clientSecret: env.NOTIFIER_CLIENT_SECRET,
    redirectUri: env.NOTIFIER_OAUTH_REDIRECT_URI,
    authorizeUrl: env.NOTIFIER_AUTHORIZE_URL,
    tokenUrl: env.NOTIFIER_TOKEN_URL,
  };
}

const STATE_TTL_MS = 10 * 60 * 1000;
interface PendingState {
  userId: string;
  provider: OAuthProviderKind;
  expiresAt: number;
}
const pendingStates = new Map<string, PendingState>();

function sweepExpiredStates() {
  const now = Date.now();
  for (const [state, entry] of pendingStates) {
    if (entry.expiresAt < now) pendingStates.delete(state);
  }
}

export async function buildAuthorizeUrl(
  provider: OAuthProviderKind,
  userId: string,
): Promise<{ url: string; state: string }> {
  sweepExpiredStates();
  const config = await configFor(provider);
  const state = randomUUID();
  pendingStates.set(state, { userId, provider, expiresAt: Date.now() + STATE_TTL_MS });

  const url = new URL(config.authorizeUrl);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  if (config.scope) url.searchParams.set('scope', config.scope);
  if (config.audience) url.searchParams.set('audience', config.audience);
  for (const [key, value] of Object.entries(config.extraAuthorizeParams ?? {})) {
    url.searchParams.set(key, value);
  }

  return { url: url.toString(), state };
}

export function consumeState(state: string): PendingState {
  sweepExpiredStates();
  const entry = pendingStates.get(state);
  if (!entry) throw new AppError('InvalidOAuthState', 400);
  pendingStates.delete(state);
  return entry;
}

export interface TokenExchangeResult {
  accessToken: string;
  refreshToken?: string;
  expiresInSec?: number;
}

export async function exchangeCodeForTokens(
  provider: OAuthProviderKind,
  code: string,
): Promise<TokenExchangeResult> {
  const config = await configFor(provider);
  const res = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
    }),
  });
  if (!res.ok) {
    throw new AppError('OAuthTokenExchangeFailed', 502);
  }
  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresInSec: data.expires_in };
}
