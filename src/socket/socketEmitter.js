const { getSocketServer } = require("./socketManager");
const { SOCKET_EVENTS } = require("./socketEvents");

function disconnectUserSockets(userId) {
  getSocketServer().in(`user:${userId}`).disconnectSockets(true);
}

function emitMatchCreated(match) {
  getSocketServer()
    .to(`game:lobby:${match.gameId}`)
    .emit(SOCKET_EVENTS.MATCH_CREATED, {
      matchId: match.id,
      match: {
        id: match.id,
        gameId: match.gameId,
        gameCode: match.gameCode,
        player1: match.player1,
        player1Name: match.player1Name,
        player1Amount: match.player1Amount,
        status: match.status,
        prizePool: match.prizePool,
        createdAt: match.createdAt,
      },
    });
}

function emitMatchJoined(match) {
  const payload = {
    matchId: match.id,
    player2Name: match.player2Name,
    status: match.status,
    prizePool: match.prizePool,
  };
  const io = getSocketServer();

  io.to(`game:lobby:${match.gameId}`).emit(
    SOCKET_EVENTS.MATCH_JOINED,
    payload
  );
  io.to(`match:${match.id}`).emit(SOCKET_EVENTS.MATCH_UPDATED, payload);
}

function emitMatchPlayerLeft(match) {
  const payload = { matchId: match.id, status: match.status };
  const io = getSocketServer();

  io.to(`game:lobby:${match.gameId}`).emit(
    SOCKET_EVENTS.MATCH_PLAYER_LEFT,
    payload
  );
  io.to(`match:${match.id}`).emit(SOCKET_EVENTS.MATCH_UPDATED, payload);
}

function emitMatchCancelled(match) {
  const payload = { matchId: match.id, status: match.status };
  const io = getSocketServer();

  io.to(`game:lobby:${match.gameId}`).emit(
    SOCKET_EVENTS.MATCH_CANCELLED,
    payload
  );
  io.to(`match:${match.id}`).emit(SOCKET_EVENTS.MATCH_UPDATED, payload);
}

function emitRoomCodeUpdated(match) {
  getSocketServer()
    .to(`match:${match.id}`)
    .emit(SOCKET_EVENTS.ROOM_CODE_UPDATED, {
      matchId: match.id,
      roomCode: match.roomCode,
    });
}

function emitResultSubmitted(match) {
  const payload = {
    matchId: match.id,
    status: match.status,
    winnerClaimedBy: match.winnerClaimedBy,
    winnerClaimStatus: match.winnerClaimStatus,
  };
  getSocketServer()
    .to(`match:${match.id}`)
    .emit(SOCKET_EVENTS.RESULT_SUBMITTED, payload);
  getSocketServer()
    .to(`match:${match.id}`)
    .emit(SOCKET_EVENTS.MATCH_RESULT_UPDATED, payload);
}

function emitDisputeSubmitted(match) {
  const payload = {
    matchId: match.id,
    status: match.status,
    disputeClaimedBy: match.disputeClaimedBy,
    winnerClaimStatus: match.winnerClaimStatus,
  };
  const io = getSocketServer();
  io.to(`match:${match.id}`).emit(SOCKET_EVENTS.DISPUTE_SUBMITTED, payload);
  io.to(`match:${match.id}`).emit(SOCKET_EVENTS.MATCH_RESULT_UPDATED, payload);
}

function emitMatchSettled(settlement) {
  getSocketServer()
    .to(`match:${settlement.matchId}`)
    .emit(SOCKET_EVENTS.MATCH_SETTLED, {
      matchId: settlement.matchId,
      status: settlement.status,
      winnerUserId: settlement.winnerUserId,
      winnerAmount: settlement.winnerAmount,
    });
}

function emitMatchRefunded(settlement) {
  getSocketServer()
    .to(`match:${settlement.matchId}`)
    .emit(SOCKET_EVENTS.MATCH_REFUNDED, {
      matchId: settlement.matchId,
      status: settlement.status,
    });
}

function emitMatchClaimRejected(settlement) {
  getSocketServer()
    .to(`match:${settlement.matchId}`)
    .emit(SOCKET_EVENTS.MATCH_CLAIM_REJECTED, {
      matchId: settlement.matchId,
      status: settlement.status,
    });
}

function emitDepositApproved(deposit) {
  getSocketServer()
    .to(`user:${deposit.userId}`)
    .emit(SOCKET_EVENTS.DEPOSIT_APPROVED, {
      transactionId: deposit.transactionId,
      amount: deposit.amount,
      status: deposit.status,
    });
}

function emitDepositRejected(deposit) {
  getSocketServer()
    .to(`user:${deposit.userId}`)
    .emit(SOCKET_EVENTS.DEPOSIT_REJECTED, {
      transactionId: deposit.transactionId,
      amount: deposit.amount,
      status: deposit.status,
    });
}

function emitWithdrawalSuccess(withdrawal) {
  getSocketServer()
    .to(`user:${withdrawal.userId}`)
    .emit(SOCKET_EVENTS.WITHDRAWAL_SUCCESS, {
      transactionId: withdrawal.transactionId,
      amount: withdrawal.amount,
      status: withdrawal.status,
    });
}

function emitWithdrawalFailed(withdrawal) {
  getSocketServer()
    .to(`user:${withdrawal.userId}`)
    .emit(SOCKET_EVENTS.WITHDRAWAL_FAILED, {
      transactionId: withdrawal.transactionId,
      amount: withdrawal.amount,
      status: withdrawal.status,
    });
}

function emitSupportTicketCreated(ticket) {
  getSocketServer()
    .to("admins")
    .emit(SOCKET_EVENTS.SUPPORT_TICKET_CREATED, {
      ticketId: ticket.ticketId,
      status: ticket.status,
    });
}

function emitSupportTicketUpdated(ticket) {
  getSocketServer()
    .to(`user:${ticket.userId}`)
    .emit(SOCKET_EVENTS.SUPPORT_TICKET_UPDATED, {
      ticketId: ticket.ticketId,
      status: ticket.status,
    });
}

function emitSupportTicketResolved(ticket) {
  getSocketServer()
    .to(`user:${ticket.userId}`)
    .emit(SOCKET_EVENTS.SUPPORT_TICKET_RESOLVED, {
      ticketId: ticket.ticketId,
      status: ticket.status,
    });
}

module.exports = {
  disconnectUserSockets,
  emitMatchCreated,
  emitMatchJoined,
  emitMatchPlayerLeft,
  emitMatchCancelled,
  emitRoomCodeUpdated,
  emitResultSubmitted,
  emitDisputeSubmitted,
  emitMatchSettled,
  emitMatchRefunded,
  emitMatchClaimRejected,
  emitDepositApproved,
  emitDepositRejected,
  emitWithdrawalSuccess,
  emitWithdrawalFailed,
  emitSupportTicketCreated,
  emitSupportTicketUpdated,
  emitSupportTicketResolved,
};
