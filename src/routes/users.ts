import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler';
import { ValidationError } from '../lib/httpError';
import { attachLocalUser, AuthedRequest } from '../middleware/localUser';
import { prisma } from '../prismaClient';
import { MIN_JIRA_POLL_INTERVAL_SECONDS } from '../services/jiraPollScanner';

export const usersRouter = Router();

usersRouter.use(attachLocalUser);

function serializeSettings(user: {
  defaultWarningLeadMinutes: number;
  appMode: string;
  workingHourStart: number;
  workingHourEnd: number;
  timeFormat: string;
  jiraPollIntervalSeconds: number;
  voiceProvider: string;
  voiceLanguage: string;
}) {
  return {
    defaultWarningLeadMinutes: user.defaultWarningLeadMinutes,
    appMode: user.appMode,
    workingHourStart: user.workingHourStart,
    workingHourEnd: user.workingHourEnd,
    timeFormat: user.timeFormat,
    jiraPollIntervalSeconds: user.jiraPollIntervalSeconds,
    voiceProvider: user.voiceProvider,
    voiceLanguage: user.voiceLanguage,
  };
}

function assertValidMinuteOfDay(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 1439) {
    throw new ValidationError(`${field} must be an integer between 0 and 1439 (minutes from midnight)`);
  }
  return value as number;
}

usersRouter.get(
  '/users/me/settings',
  asyncHandler(async (req: AuthedRequest, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    res.json(serializeSettings(user));
  }),
);

usersRouter.patch(
  '/users/me/settings',
  asyncHandler(async (req: AuthedRequest, res) => {
    const {
      defaultWarningLeadMinutes,
      appMode,
      workingHourStart,
      workingHourEnd,
      timeFormat,
      jiraPollIntervalSeconds,
      voiceProvider,
      voiceLanguage,
    } = req.body ?? {};
    const data: {
      defaultWarningLeadMinutes?: number;
      appMode?: string;
      workingHourStart?: number;
      workingHourEnd?: number;
      timeFormat?: string;
      jiraPollIntervalSeconds?: number;
      voiceProvider?: string;
      voiceLanguage?: string;
    } = {};

    if (defaultWarningLeadMinutes !== undefined) {
      if (!Number.isInteger(defaultWarningLeadMinutes) || defaultWarningLeadMinutes < 1) {
        throw new ValidationError('defaultWarningLeadMinutes must be a positive integer (minutes)');
      }
      data.defaultWarningLeadMinutes = defaultWarningLeadMinutes;
    }

    if (appMode !== undefined) {
      if (appMode !== 'demo' && appMode !== 'production') {
        throw new ValidationError('appMode must be "demo" or "production"');
      }
      data.appMode = appMode;
    }

    if (workingHourStart !== undefined) data.workingHourStart = assertValidMinuteOfDay(workingHourStart, 'workingHourStart');
    if (workingHourEnd !== undefined) data.workingHourEnd = assertValidMinuteOfDay(workingHourEnd, 'workingHourEnd');

    if (timeFormat !== undefined) {
      if (timeFormat !== '12h' && timeFormat !== '24h') {
        throw new ValidationError('timeFormat must be "12h" or "24h"');
      }
      data.timeFormat = timeFormat;
    }

    if (jiraPollIntervalSeconds !== undefined) {
      if (!Number.isInteger(jiraPollIntervalSeconds) || jiraPollIntervalSeconds < MIN_JIRA_POLL_INTERVAL_SECONDS) {
        throw new ValidationError(`jiraPollIntervalSeconds must be an integer >= ${MIN_JIRA_POLL_INTERVAL_SECONDS}`);
      }
      data.jiraPollIntervalSeconds = jiraPollIntervalSeconds;
    }

    if (voiceProvider !== undefined) {
      if (voiceProvider !== 'piper' && voiceProvider !== 'elevenlabs') {
        throw new ValidationError('voiceProvider must be "piper" or "elevenlabs"');
      }
      data.voiceProvider = voiceProvider;
    }

    if (voiceLanguage !== undefined) {
      if (voiceLanguage !== 'vi' && voiceLanguage !== 'en' && voiceLanguage !== 'ja') {
        throw new ValidationError('voiceLanguage must be "vi", "en" or "ja"');
      }
      data.voiceLanguage = voiceLanguage;
    }

    const user = await prisma.user.update({ where: { id: req.user!.id }, data });
    res.json(serializeSettings(user));
  }),
);
