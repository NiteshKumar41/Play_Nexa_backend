const supportService = require("../services/supportService");
const { emitSupportTicketCreated } = require("../socket/socketEmitter");

async function createTicket(request, response, next) {
  try {
    const ticket = await supportService.createTicket(
      request.user.id,
      request.body,
      request.file
    );
    emitSupportTicketCreated(ticket);
    return response.status(201).json({
      success: true,
      message: "Support ticket created successfully",
      data: {
        ticketId: ticket.ticketId,
        subject: ticket.subject,
        status: ticket.status,
        createdAt: ticket.createdAt,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getMyTickets(request, response, next) {
  try {
    const data = await supportService.getUserTickets(
      request.user.id,
      request.query
    );
    return response.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
}

async function getMyTicket(request, response, next) {
  try {
    const ticket = await supportService.getUserTicket(
      request.params.ticketId,
      request.user.id
    );
    return response.status(200).json({
      success: true,
      data: { ticket },
    });
  } catch (error) {
    return next(error);
  }
}

async function getTicketImage(request, response, next) {
  try {
    const image = await supportService.getTicketImage(
      request.params.ticketId,
      request.params.fileName,
      request.user.id,
      request.user.role
    );
    response.set("Content-Type", image.contentType);
    response.set("Cache-Control", "private, no-store");
    response.set("X-Content-Type-Options", "nosniff");
    return response.send(image.buffer);
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createTicket,
  getMyTickets,
  getMyTicket,
  getTicketImage,
};
