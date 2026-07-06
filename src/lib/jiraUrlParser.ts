import { BadJiraUrlError } from './httpError';

const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9]*-\d+$/i;

export function parseJiraKey(jiraUrl: string): string {
  let url: URL;
  try {
    url = new URL(jiraUrl);
  } catch {
    throw new BadJiraUrlError();
  }

  const segments = url.pathname.split('/').filter(Boolean);
  const candidate = segments[segments.length - 1];

  if (!candidate || !ISSUE_KEY_PATTERN.test(candidate)) {
    throw new BadJiraUrlError();
  }

  return candidate.toUpperCase();
}
