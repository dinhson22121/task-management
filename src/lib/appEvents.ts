import { EventEmitter } from 'events';

export const APP_EVENT_NAMES = [
  'TicketAdded',
  'TicketUpdated',
  'TicketWarning',
  'TicketOverdue',
  'TicketResolved',
  'TicketDone',
  'PoolCapacityChanged',
  'IntegrationConnected',
] as const;

export type AppEventName = (typeof APP_EVENT_NAMES)[number];

export const appEvents = new EventEmitter();
