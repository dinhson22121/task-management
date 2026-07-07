export class AppError extends Error {
  constructor(
    public readonly error: string,
    public readonly status: number,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(error);
    this.name = 'AppError';
  }
}

export class PoolCapacityExceededError extends AppError {
  constructor(capacity: number, current: number) {
    super('PoolCapacityExceeded', 409, { capacity, current });
  }
}

export class BadJiraUrlError extends AppError {
  constructor(message = 'Could not parse a Jira issue key from the given URL') {
    super('BadJiraUrl', 400, { message });
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super('ValidationError', 400, { message });
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super('NotFound', 404, { resource });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super('Unauthorized', 401, { message });
  }
}

export class JiraNotConfiguredError extends AppError {
  constructor() {
    super('JiraNotConfigured', 400, { message: 'Save your Jira Client ID/Secret in Settings first.' });
  }
}

export class JiraNotConnectedError extends AppError {
  constructor() {
    super('JiraNotConnected', 409, { message: 'Connect Jira in Settings before adding a ticket in Production mode.' });
  }
}

export class JiraReauthRequiredError extends AppError {
  constructor() {
    super('JiraReauthRequired', 401, { message: 'Your Jira connection expired — reconnect in Settings.' });
  }
}

export class DueDateRequiredError extends AppError {
  constructor() {
    super('DueDateRequired', 400, { message: 'This Jira issue has no due date. Enter one to add it.' });
  }
}

export class JiraApiTokenInvalidError extends AppError {
  constructor() {
    super('JiraApiTokenInvalid', 401, { message: 'Could not verify this Jira email/API token — check your credentials.' });
  }
}
