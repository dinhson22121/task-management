import { decrypt } from '../../lib/tokenCrypto';
import { prisma } from '../../prismaClient';
import { NotificationProvider } from '../../types';

export const teamsNotifier: NotificationProvider = {
  providerName: 'teams',
  async send(event, recipient) {
    const connection = await prisma.integrationConnection.findUnique({
      where: { userId_provider: { userId: recipient.id, provider: 'notifier' } },
    });
    if (!connection) {
      console.log(`[teams:stub] ${recipient.email} has no notifier connection — skipping ${event.type} for ${event.ticketId}`);
      return;
    }
    const token = decrypt(connection.authTokenEncrypted);

    console.log(
      `[teams:stub] would notify ${recipient.email} (token length ${token.length}) about ${event.type} on ticket ${event.ticketId}`,
    );
  },
};
