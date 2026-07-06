import { decrypt, encrypt } from '../lib/tokenCrypto';
import { prisma } from '../prismaClient';

const SINGLETON_ID = 'singleton';

export async function getJiraConfig(): Promise<{ clientId: string; clientSecret: string } | null> {
  const row = await prisma.jiraConfig.findUnique({ where: { id: SINGLETON_ID } });
  if (!row) return null;
  return { clientId: row.clientId, clientSecret: decrypt(row.clientSecretEncrypted) };
}

export async function saveJiraConfig(clientId: string, clientSecret: string): Promise<void> {
  await prisma.jiraConfig.upsert({
    where: { id: SINGLETON_ID },
    update: { clientId, clientSecretEncrypted: encrypt(clientSecret) },
    create: { id: SINGLETON_ID, clientId, clientSecretEncrypted: encrypt(clientSecret) },
  });
}
