import { prisma } from '../prismaClient';
import { fetchIssueUpdate } from './jiraClient';
import { markTicketDone, updateTicket } from './poolService';

export const MIN_JIRA_POLL_INTERVAL_SECONDS = 15;
const DEFAULT_JIRA_POLL_INTERVAL_SECONDS = 300;

export interface JiraPollStatus {
  lastAttemptAt: Date | null;
  offline: boolean;
}

let pollStatus: JiraPollStatus = { lastAttemptAt: null, offline: false };

export function getJiraPollStatus(): JiraPollStatus {
  return pollStatus;
}

function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError;
}

export async function runJiraPollScan(): Promise<void> {
  const tickets = await prisma.ticket.findMany({
    where: { status: { not: 'Done' } },
    include: { pool: { include: { owner: true } } },
  });

  let sawNetworkFailure = false;
  let sawSuccess = false;
  let attemptedAnyFetch = false;

  for (const ticket of tickets) {
    const owner = ticket.pool.owner;
    if (owner.appMode !== 'production') continue;

    let update;
    attemptedAnyFetch = true;
    try {
      update = await fetchIssueUpdate(owner.id, ticket.jiraKey);
      sawSuccess = true;
    } catch (err) {
      if (isNetworkError(err)) sawNetworkFailure = true;
      continue;
    }
    if (!update) continue;

    if (update.deadline && update.deadline.getTime() !== ticket.deadline.getTime()) {
      await updateTicket(ticket.poolId, ticket.id, { deadline: update.deadline });
    }

    if (update.statusCategoryKey === 'done') {
      await markTicketDone(ticket.poolId, ticket.id);
    }
  }

  if (attemptedAnyFetch) {
    pollStatus = { lastAttemptAt: new Date(), offline: sawNetworkFailure && !sawSuccess };
  }
}

async function getPollIntervalMs(): Promise<number> {
  const user = await prisma.user.findFirst();
  const seconds = user?.jiraPollIntervalSeconds ?? DEFAULT_JIRA_POLL_INTERVAL_SECONDS;
  return Math.max(seconds, MIN_JIRA_POLL_INTERVAL_SECONDS) * 1000;
}

export function startJiraPollScanner() {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  async function tick() {
    if (stopped) return;
    try {
      await runJiraPollScan();
    } catch (err) {
      console.error('jiraPollScanner tick failed', err);
    }
    if (stopped) return;
    const intervalMs = await getPollIntervalMs();
    timer = setTimeout(tick, intervalMs);
  }

  getPollIntervalMs().then((intervalMs) => {
    if (!stopped) timer = setTimeout(tick, intervalMs);
  });

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
