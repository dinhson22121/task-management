import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler';
import { attachLocalUser, AuthedRequest } from '../middleware/localUser';
import * as poolService from '../services/poolService';

export const poolsRouter = Router();

poolsRouter.use(attachLocalUser);

poolsRouter.get(
  '/pools',
  asyncHandler(async (req: AuthedRequest, res) => {
    const pools = await poolService.listPools(req.user!.id);
    res.json(pools);
  }),
);

poolsRouter.post(
  '/pools',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { name, capacity, defaultWarningLeadMinutes } = req.body ?? {};
    const pool = await poolService.createPool(req.user!.id, name, capacity, defaultWarningLeadMinutes);
    res.status(201).json(pool);
  }),
);

poolsRouter.get(
  '/pools/:id',
  asyncHandler(async (req, res) => {
    const pool = await poolService.getPool(req.params.id);
    res.json(pool);
  }),
);

poolsRouter.patch(
  '/pools/:id',
  asyncHandler(async (req, res) => {
    const { name, capacity } = req.body ?? {};
    const pool = await poolService.updatePool(req.params.id, { name, capacity });
    res.json(pool);
  }),
);
