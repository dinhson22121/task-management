import { decrypt } from '../../lib/tokenCrypto';
import { prisma } from '../../prismaClient';
import { NotificationProvider } from '../../types';

export const slackNotifier: NotificationProvider = {
  providerName: 'slack',
  async send(event, recipient) {
    const connection = await prisma.integrationConnection.findUnique({
      where: { userId_provider: { userId: recipient.id, provider: 'notifier' } },
    });
    if (!connection) {
      console.log(`[slack:stub] ${recipient.email} has no notifier connection — skipping ${event.type} for ${event.ticketId}`);
      return;
    }
    const token = decrypt(connection.authTokenEncrypted);

    console.log(
      `[slack:stub] would notify ${recipient.email} (token length ${token.length}) about ${event.type} on ticket ${event.ticketId}`,
    );
  },
};
