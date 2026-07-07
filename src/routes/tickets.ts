import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler';
import { attachLocalUser } from '../middleware/localUser';
import * as poolService from '../services/poolService';

export const ticketsRouter = Router({ mergeParams: true });

ticketsRouter.use(attachLocalUser);

ticketsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const tickets = await poolService.listTickets(req.params.id);
    res.json(tickets);
  }),
);

ticketsRouter.get(
  '/done',
  asyncHandler(async (req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const tickets = await poolService.listDoneTickets(req.params.id, search);
    res.json(tickets);
  }),
);

ticketsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { jiraUrl, dueDate, note, confirmNoDueDate } = req.body ?? {};
    const ticket = await poolService.addTicketToPool(req.params.id, jiraUrl, dueDate, note, confirmNoDueDate);
    res.status(201).json(ticket);
  }),
);

ticketsRouter.post(
  '/:ticketId/done',
  asyncHandler(async (req, res) => {
    const ticket = await poolService.markTicketDone(req.params.id, req.params.ticketId);
    res.json(ticket);
  }),
);

ticketsRouter.patch(
  '/:ticketId',
  asyncHandler(async (req, res) => {
    const { deadline, warningLeadMinutes, note } = req.body ?? {};
    const data: { deadline?: Date; warningLeadMinutes?: number | null; note?: string | null } = {};
    if (deadline !== undefined) data.deadline = new Date(deadline);
    if (warningLeadMinutes !== undefined) data.warningLeadMinutes = warningLeadMinutes;
    if (note !== undefined) data.note = note;
    const ticket = await poolService.updateTicket(req.params.id, req.params.ticketId, data);
    res.json(ticket);
  }),
);

ticketsRouter.delete(
  '/:ticketId',
  asyncHandler(async (req, res) => {
    await poolService.removeTicket(req.params.id, req.params.ticketId);
    res.status(204).end();
  }),
);
