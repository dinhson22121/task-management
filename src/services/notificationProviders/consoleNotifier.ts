import { NotificationProvider } from '../../types';

export const consoleNotifier: NotificationProvider = {
  providerName: 'console',
  async send(event, recipient) {
    console.log(`[notify:${recipient.email}] ${event.type} on ticket ${event.ticketId} (channel=${event.channel})`);
  },
};
