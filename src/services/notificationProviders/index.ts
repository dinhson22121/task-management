import { NotificationProvider } from '../../types';
import { consoleNotifier } from './consoleNotifier';
import { slackNotifier } from './slackNotifier';
import { teamsNotifier } from './teamsNotifier';

const registry: Record<string, NotificationProvider> = {
  console: consoleNotifier,
  slack: slackNotifier,
  teams: teamsNotifier,
};

export function getNotificationProvider(name?: string | null): NotificationProvider {
  return (name && registry[name]) || registry.console;
}
