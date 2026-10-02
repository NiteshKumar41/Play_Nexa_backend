const matchService = require("../services/matchService");
const {
  emitMatchCreated,
  emitMatchJoined,
  emitMatchPlayerLeft,
  emitMatchCancelled,
  emitRoomCodeUpdated,
} = require("../socket/socketEmitter");

async function createMatch(request, response, next) {
  try {
    const match = await matchService.createMatch(request.body, request.user.id);
    emitMatchCreated(match);

    return response.status(201).json({
      success: true,
      message: "Match created successfully",
      data: { match },
    });
  } catch (error) {
    return next(error);
  }
}

async function getMatches(request, response, next) {
  try {
    const page = Number(request.query.page ?? 1);
    const limit = Number(request.query.limit ?? 10);
    const data = await matchService.getMatches(request.query.gameId, {
      page,
      limit,
    });

    return response.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return next(error);
  }
}

async function getMatchById(request, response, next) {
  try {
    const match = await matchService.getMatchById(
      request.params.matchId,
      request.user.id,
      request.user.role
    );

    return response.status(200).json({
      success: true,
      data: { match },
    });
  } catch (error) {
    return next(error);
  }
}

async function joinMatch(request, response, next) {
  try {
    const match = await matchService.joinMatch(
      request.params.matchId,
      request.user.id
    );
    emitMatchJoined(match);

    return response.status(200).json({
      success: true,
      message: "Match joined successfully",
      data: { match },
    });
  } catch (error) {
    return next(error);
  }
}

async function setRoomCode(request, response, next) {
  try {
    const match = await matchService.setRoomCode(
      request.params.matchId,
      request.user.id,
      request.body?.roomCode
    );
    emitRoomCodeUpdated(match);

    return response.status(200).json({
      success: true,
      message: "Room code updated successfully",
      data: { match },
    });
  } catch (error) {
    return next(error);
  }
}

async function leaveMatch(request, response, next) {
  try {
    const match = await matchService.leaveMatch(
      request.params.matchId,
      request.user.id
    );
    emitMatchPlayerLeft(match);

    return response.status(200).json({
      success: true,
      message: "You left the match and your entry fee was refunded",
      data: { match },
    });
  } catch (error) {
    return next(error);
  }
}

async function cancelMatch(request, response, next) {
  try {
    const match = await matchService.cancelMatch(
      request.params.matchId,
      request.user.id
    );
    emitMatchCancelled(match);

    return response.status(200).json({
      success: true,
      message: "Match cancelled and entry fee refunded",
      data: { match },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createMatch,
  getMatches,
  getMatchById,
  joinMatch,
  setRoomCode,
  leaveMatch,
  cancelMatch,
};
