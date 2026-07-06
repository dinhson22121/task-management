export interface JiraIssueData {
  title: string;
  description: string | null;
  deadline: Date;
}

export interface NotificationEventLike {
  id: string;
  ticketId: string;
  type: 'Warning' | 'Overdue' | 'CapacityBlocked';
  channel: 'push' | 'chat' | 'email';
}

export interface NotificationRecipient {
  id: string;
  email: string;
}

export interface NotificationProvider {
  readonly providerName: string;
  send(event: NotificationEventLike, recipient: NotificationRecipient): Promise<void>;
}

export type OAuthProviderKind = 'jira' | 'notifier';
