const { getSocketServer } = require("./socketManager");
const { SOCKET_EVENTS } = require("./socketEvents");

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

module.exports = {
  emitMatchCreated,
  emitMatchJoined,
  emitMatchPlayerLeft,
  emitMatchCancelled,
  emitRoomCodeUpdated,
  emitResultSubmitted,
  emitDisputeSubmitted,
};
