import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const tokenEncryptionKeyHex = required('TOKEN_ENCRYPTION_KEY');
const tokenEncryptionKey = Buffer.from(tokenEncryptionKeyHex, 'hex');
if (tokenEncryptionKey.length !== 32) {
  throw new Error(
    `TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes (got ${tokenEncryptionKey.length}). ` +
      `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
  );
}

export const env = {
  PORT: Number(process.env.PORT) || 4000,
  TOKEN_ENCRYPTION_KEY: tokenEncryptionKey,

  LOCAL_USER_EMAIL: process.env.LOCAL_USER_EMAIL || 'local@device',

  JIRA_AUTHORIZE_URL: process.env.JIRA_AUTHORIZE_URL || 'https://auth.atlassian.com/authorize',
  JIRA_TOKEN_URL: process.env.JIRA_TOKEN_URL || 'https://auth.atlassian.com/oauth/token',

  NOTIFIER_PROVIDER_NAME: process.env.NOTIFIER_PROVIDER_NAME || 'slack',
  NOTIFIER_CLIENT_ID: process.env.NOTIFIER_CLIENT_ID || '',
  NOTIFIER_CLIENT_SECRET: process.env.NOTIFIER_CLIENT_SECRET || '',
  NOTIFIER_AUTHORIZE_URL: process.env.NOTIFIER_AUTHORIZE_URL || 'https://slack.com/oauth/v2/authorize',
  NOTIFIER_TOKEN_URL: process.env.NOTIFIER_TOKEN_URL || 'https://slack.com/api/oauth.v2.access',
  NOTIFIER_OAUTH_REDIRECT_URI: process.env.NOTIFIER_OAUTH_REDIRECT_URI || '',
};
