const supportService = require("../services/supportService");
const {
  emitSupportTicketUpdated,
  emitSupportTicketResolved,
} = require("../socket/socketEmitter");

async function getTickets(request, response, next) {
  try {
    const data = await supportService.getAdminTickets(request.query);
    return response.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
}

async function getTicket(request, response, next) {
  try {
    const ticket = await supportService.getTicketById(request.params.ticketId);
    return response.status(200).json({
      success: true,
      data: { ticket },
    });
  } catch (error) {
    return next(error);
  }
}

async function updateStatus(request, response, next) {
  try {
    const ticket = await supportService.updateTicketStatus(
      request.params.ticketId,
      request.body?.status
    );
    emitSupportTicketUpdated(ticket);
    return response.status(200).json({
      success: true,
      message: "Ticket status updated",
      data: {
        ticket: { ticketId: ticket.ticketId, status: ticket.status },
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function resolveTicket(request, response, next) {
  try {
    const ticket = await supportService.resolveTicket(
      request.params.ticketId,
      request.user.id,
      request.body?.resolution
    );
    emitSupportTicketResolved(ticket);
    return response.status(200).json({
      success: true,
      message: "Ticket resolved",
      data: {
        ticket: { ticketId: ticket.ticketId, status: ticket.status },
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function closeTicket(request, response, next) {
  try {
    const ticket = await supportService.closeTicket(request.params.ticketId);
    emitSupportTicketUpdated(ticket);
    return response.status(200).json({
      success: true,
      message: "Ticket closed",
      data: {
        ticket: { ticketId: ticket.ticketId, status: ticket.status },
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function reopenTicket(request, response, next) {
  try {
    const ticket = await supportService.reopenTicket(request.params.ticketId);
    emitSupportTicketUpdated(ticket);
    return response.status(200).json({
      success: true,
      message: "Ticket reopened",
      data: {
        ticket: { ticketId: ticket.ticketId, status: ticket.status },
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function assignTicket(request, response, next) {
  try {
    const ticket = await supportService.assignTicket(
      request.params.ticketId,
      request.body?.adminId
    );
    emitSupportTicketUpdated(ticket);
    return response.status(200).json({
      success: true,
      message: "Ticket assigned",
      data: {
        ticket: { ticketId: ticket.ticketId, status: ticket.status },
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getTickets,
  getTicket,
  updateStatus,
  resolveTicket,
  closeTicket,
  reopenTicket,
  assignTicket,
};
