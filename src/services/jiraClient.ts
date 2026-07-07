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
  statusName: string | null;
}

export interface JiraAuthContext {
  authMethod: string;
  cloudId: string | null;
  siteUrl: string | null;
  email: string | null;
  secret: string;
}

function isConnectionUsable(connection: {
  authMethod: string;
  cloudId: string | null;
  siteUrl: string | null;
  email: string | null;
} | null): boolean {
  if (!connection) return false;
  if (connection.authMethod === 'api_token') return !!connection.siteUrl && !!connection.email;
  return !!connection.cloudId;
}

function buildJiraRequest(auth: JiraAuthContext, path: string): { url: string; headers: Record<string, string> } {
  if (auth.authMethod === 'api_token') {
    const basic = Buffer.from(`${auth.email}:${auth.secret}`).toString('base64');
    return {
      url: `${auth.siteUrl}${path}`,
      headers: { Authorization: `Basic ${basic}`, Accept: 'application/json' },
    };
  }
  return {
    url: `https://api.atlassian.com/ex/jira/${auth.cloudId}${path}`,
    headers: { Authorization: `Bearer ${auth.secret}`, Accept: 'application/json' },
  };
}

async function fetchJiraIssueFields(auth: JiraAuthContext, key: string): Promise<RawJiraIssueFields> {
  const { url, headers } = buildJiraRequest(auth, `/rest/api/3/issue/${key}?fields=summary,description,duedate,status`);
  const res = await fetch(url, { headers });
  if (res.status === 401) throw new JiraReauthRequiredError();
  if (!res.ok) throw new AppError('JiraIssueFetchFailed', 502, { status: res.status });

  const data = (await res.json()) as {
    fields: {
      summary: string;
      description: unknown;
      duedate: string | null;
      status?: { name?: string; statusCategory?: { key?: string } };
    };
  };
  return {
    summary: data.fields.summary,
    description: data.fields.description,
    duedate: data.fields.duedate,
    statusCategoryKey: data.fields.status?.statusCategory?.key ?? null,
    statusName: data.fields.status?.name ?? null,
  };
}

export async function resolveIssue(
  jiraUrl: string,
  key: string,
  ownerId: string,
  client: PrismaOrTx = prisma,
  manualDueDate?: string,
  confirmNoDueDate = false,
): Promise<JiraIssueData> {
  const user = await client.user.findUniqueOrThrow({ where: { id: ownerId } });

  if (user.appMode !== 'production') {
    return {
      title: `Mock title for ${key}`,
      description: `Auto-generated mock description for ${key} (source: ${jiraUrl})`,
      deadline: new Date(Date.now() + DEFAULT_DEADLINE_OFFSET_MS),
      jiraStatus: 'In Progress',
    };
  }

  const connection = await client.integrationConnection.findUnique({
    where: { userId_provider: { userId: ownerId, provider: 'jira' } },
  });
  if (!isConnectionUsable(connection)) throw new JiraNotConnectedError();

  const secret = decrypt(connection!.authTokenEncrypted);
  const fields = await fetchJiraIssueFields(
    { authMethod: connection!.authMethod, cloudId: connection!.cloudId, siteUrl: connection!.siteUrl, email: connection!.email, secret },
    key,
  );

  const dueDateOnly = fields.duedate ?? manualDueDate;
  if (!dueDateOnly && !confirmNoDueDate) throw new DueDateRequiredError();

  return {
    title: fields.summary,
    description: adfToPlainText(fields.description),
    deadline: dueDateOnly ? dueDateToDeadline(dueDateOnly, user.workingHourEnd) : null,
    jiraStatus: fields.statusName,
  };
}

export interface JiraIssueUpdate {
  deadline: Date | null;
  statusCategoryKey: string | null;
  jiraStatus: string | null;
}

export async function fetchIssueUpdate(
  ownerId: string,
  key: string,
  client: PrismaOrTx = prisma,
): Promise<JiraIssueUpdate | null> {
  const connection = await client.integrationConnection.findUnique({
    where: { userId_provider: { userId: ownerId, provider: 'jira' } },
  });
  if (!isConnectionUsable(connection)) return null;

  const user = await client.user.findUniqueOrThrow({ where: { id: ownerId } });
  const secret = decrypt(connection!.authTokenEncrypted);
  const fields = await fetchJiraIssueFields(
    { authMethod: connection!.authMethod, cloudId: connection!.cloudId, siteUrl: connection!.siteUrl, email: connection!.email, secret },
    key,
  );

  return {
    deadline: fields.duedate ? dueDateToDeadline(fields.duedate, user.workingHourEnd) : null,
    statusCategoryKey: fields.statusCategoryKey,
    jiraStatus: fields.statusName,
  };
}
