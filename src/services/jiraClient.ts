import { Prisma, PrismaClient } from '@prisma/client';
import { AppError, DueDateRequiredError, JiraNotConnectedError, JiraReauthRequiredError } from '../lib/httpError';
import { decrypt } from '../lib/tokenCrypto';
import { prisma } from '../prismaClient';
import { JiraIssueData } from '../types';

type PrismaOrTx = PrismaClient | Prisma.TransactionClient;

const DEFAULT_DEADLINE_OFFSET_MS = 24 * 60 * 60 * 1000;

export function dueDateToDeadline(dateOnly: string, workingHourEndMinutes: number): Date {
  const [year, month, day] = dateOnly.split('-').map(Number);
  const hours = Math.floor(workingHourEndMinutes / 60);
  const minutes = workingHourEndMinutes % 60;
  return new Date(year, month - 1, day, hours, minutes, 0, 0);
}

interface AdfNode {
  type?: string;
  text?: string;
  content?: AdfNode[];
}

export function adfToPlainText(doc: unknown): string | null {
  if (!doc || typeof doc !== 'object') return null;
  const lines: string[] = [];
  let current = '';
  function walk(node: AdfNode) {
    if (node.type === 'text' && node.text) current += node.text;
    if (Array.isArray(node.content)) node.content.forEach(walk);
    if (node.type === 'paragraph' || node.type === 'heading') {
      lines.push(current);
      current = '';
    }
  }
  walk(doc as AdfNode);
  if (current) lines.push(current);
  const text = lines.join('\n').trim();
  return text || null;
}

interface RawJiraIssueFields {
  summary: string;
  description: unknown;
  duedate: string | null;
  statusCategoryKey: string | null;
}

async function fetchJiraIssueFields(cloudId: string, accessToken: string, key: string): Promise<RawJiraIssueFields> {
  const res = await fetch(
    `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${key}?fields=summary,description,duedate,status`,
    { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } },
  );
  if (res.status === 401) throw new JiraReauthRequiredError();
  if (!res.ok) throw new AppError('JiraIssueFetchFailed', 502, { status: res.status });

  const data = (await res.json()) as {
    fields: {
      summary: string;
      description: unknown;
      duedate: string | null;
      status?: { statusCategory?: { key?: string } };
    };
  };
  return {
    summary: data.fields.summary,
    description: data.fields.description,
    duedate: data.fields.duedate,
    statusCategoryKey: data.fields.status?.statusCategory?.key ?? null,
  };
}

export async function resolveIssue(
  jiraUrl: string,
  key: string,
  ownerId: string,
  client: PrismaOrTx = prisma,
  manualDueDate?: string,
): Promise<JiraIssueData> {
  const user = await client.user.findUniqueOrThrow({ where: { id: ownerId } });

  if (user.appMode !== 'production') {
    return {
      title: `Mock title for ${key}`,
      description: `Auto-generated mock description for ${key} (source: ${jiraUrl})`,
      deadline: new Date(Date.now() + DEFAULT_DEADLINE_OFFSET_MS),
    };
  }

  const connection = await client.integrationConnection.findUnique({
    where: { userId_provider: { userId: ownerId, provider: 'jira' } },
  });
  if (!connection?.cloudId) throw new JiraNotConnectedError();

  const accessToken = decrypt(connection.authTokenEncrypted);
  const fields = await fetchJiraIssueFields(connection.cloudId, accessToken, key);

  const dueDateOnly = fields.duedate ?? manualDueDate;
  if (!dueDateOnly) throw new DueDateRequiredError();

  return {
    title: fields.summary,
    description: adfToPlainText(fields.description),
    deadline: dueDateToDeadline(dueDateOnly, user.workingHourEnd),
  };
}

export interface JiraIssueUpdate {
  deadline: Date | null;
  statusCategoryKey: string | null;
}

export async function fetchIssueUpdate(
  ownerId: string,
  key: string,
  client: PrismaOrTx = prisma,
): Promise<JiraIssueUpdate | null> {
  const connection = await client.integrationConnection.findUnique({
    where: { userId_provider: { userId: ownerId, provider: 'jira' } },
  });
  if (!connection?.cloudId) return null;

  const user = await client.user.findUniqueOrThrow({ where: { id: ownerId } });
  const accessToken = decrypt(connection.authTokenEncrypted);
  const fields = await fetchJiraIssueFields(connection.cloudId, accessToken, key);

  return {
    deadline: fields.duedate ? dueDateToDeadline(fields.duedate, user.workingHourEnd) : null,
    statusCategoryKey: fields.statusCategoryKey,
  };
}
