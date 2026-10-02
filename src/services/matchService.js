const mongoose = require("mongoose");
const Game = require("../models/Game");
const GameMatch = require("../models/GameMatch");
const User = require("../models/User");
const { MATCH_STATUS } = require("../constants/matchStatus");
const { TRANSACTION_TYPE } = require("../constants/transactionTypes");
const walletService = require("./walletService");
const { calculateMatchFinancials } = require("../utils/matchFinancials");

function createMatchError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function validateObjectId(value, label) {
  if (!mongoose.isValidObjectId(value)) {
    throw createMatchError(`Invalid ${label}`, 400);
  }
}

function validateEntryFee(entryFee) {
  if (
    typeof entryFee !== "number" ||
    !Number.isFinite(entryFee) ||
    entryFee <= 0
  ) {
    throw createMatchError("Entry fee must be a number greater than 0", 400);
  }
}

function formatMatch(match, game, includeEvidence = false) {
  const formattedMatch = {
    id: match._id.toString(),
    gameId: match.gameId.toString(),
    gameCode: match.gameCode,
    game: game
      ? {
          id: game._id.toString(),
          gameCode: game.gameCode,
          name: game.name,
          imageUrl: game.imageUrl,
        }
      : undefined,
    player1: match.player1.toString(),
    player1Name: match.player1Name,
    player1Amount: match.player1Amount,
    player2: match.player2?.toString() || null,
    player2Name: match.player2Name,
    player2Amount: match.player2Amount,
    roomCode: match.roomCode,
    status: match.status,
    prizePool: match.prizePool,
    platformFee: match.platformFee,
    winnerAmount: match.winnerAmount,
    createdAt: match.createdAt,
    joinedAt: match.joinedAt,
    cancelledAt: match.cancelledAt,
    completedAt: match.completedAt,
  };

  if (includeEvidence) {
    Object.assign(formattedMatch, {
      winnerPlayer: match.winnerPlayer?.toString() || null,
      winnerClaimedBy: match.winnerClaimedBy?.toString() || null,
      winnerClaimStatus: match.winnerClaimStatus,
      winnerClaimRemarks: match.winnerClaimRemarks,
      p1Screenshot: match.p1Screenshot,
      p2Screenshot: match.p2Screenshot,
      disputeReason: match.disputeReason,
      disputeClaimedBy: match.disputeClaimedBy?.toString() || null,
    });
  }

  return formattedMatch;
}

function getRequestFields(requestData, allowedFields) {
  if (
    !requestData ||
    typeof requestData !== "object" ||
    Array.isArray(requestData)
  ) {
    throw createMatchError("Invalid match details", 400);
  }

  const unexpectedFields = Object.keys(requestData).filter(
    field => !allowedFields.includes(field)
  );

  if (unexpectedFields.length > 0) {
    throw createMatchError(
      `These fields are not allowed: ${unexpectedFields.join(", ")}`,
      400
    );
  }

  return requestData;
}

async function createMatch(matchData, userId) {
  const { gameId, entryFee } = getRequestFields(matchData, [
    "gameId",
    "entryFee",
  ]);
  validateObjectId(userId, "user");
  validateObjectId(gameId, "game ID");
  validateEntryFee(entryFee);

  const session = await mongoose.startSession();
  let createdMatch;

  try {
    await session.withTransaction(async () => {
      const user = await User.findById(userId)
        .select("_id fullName phone active isBlocked")
        .session(session);

      if (!user) {
        throw createMatchError("User not found", 404);
      }

      if (user.isBlocked) {
        throw createMatchError("This account is blocked", 403);
      }

      if (!user.active) {
        throw createMatchError("This account is inactive", 403);
      }

      const game = await Game.findById(gameId).session(session);

      if (!game) {
        throw createMatchError("Game not found", 404);
      }

      if (!game.isActive || !game.isOpen) {
        throw createMatchError("This game is not open for matchmaking", 400);
      }

      const matchId = new mongoose.Types.ObjectId();
      const walletChange = await walletService.debitWallet({
        userId,
        amount: entryFee,
        transactionType: TRANSACTION_TYPE.GAME_CREATE,
        remarks: "Match entry reserved",
        referenceId: matchId.toString(),
        session,
      });

      [createdMatch] = await GameMatch.create(
        [
          {
            _id: matchId,
            gameId: game._id,
            gameCode: game.gameCode,
            player1: user._id,
            player1Name: user.fullName,
            player1Phone: user.phone,
            player1Amount: entryFee,
            player2: null,
            player2Name: null,
            player2Phone: null,
            player2Amount: null,
            walletTransactionIdPlayer1: walletChange.transactionId,
            walletTransactionIdPlayer2: null,
            status: MATCH_STATUS.ACTIVE,
            roomCode: "",
            prizePool: entryFee,
            platformFee: 0,
            winnerAmount: 0,
            createdBy: user._id,
            createdName: user.fullName,
          },
        ],
        { session }
      );
    });

    return formatMatch(createdMatch);
  } finally {
    await session.endSession();
  }
}

async function getMatches(gameId, { page = 1, limit = 10 } = {}) {
  validateObjectId(gameId, "game ID");

  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    throw createMatchError("Page must be positive and limit must be 1-100", 400);
  }

  const query = {
    gameId,
    status: MATCH_STATUS.ACTIVE,
    player2: null,
  };
  const [matches, total] = await Promise.all([
    GameMatch.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    GameMatch.countDocuments(query),
  ]);

  return {
    matches: matches.map(match => ({
      id: match._id.toString(),
      gameId: match.gameId.toString(),
      gameCode: match.gameCode,
      player1: match.player1.toString(),
      player1Name: match.player1Name,
      player1Amount: match.player1Amount,
      status: match.status,
      prizePool: match.prizePool,
      createdAt: match.createdAt,
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    },
  };
}

async function getMatchById(matchId, userId, role) {
  validateObjectId(matchId, "match ID");

  const match = await GameMatch.findById(matchId);

  if (!match) {
    throw createMatchError("Match not found", 404);
  }

  const game = await Game.findById(match.gameId).select(
    "_id gameCode name imageUrl"
  );

  const isParticipant =
    match.player1.toString() === userId ||
    match.player2?.toString() === userId;
  return formatMatch(match, game, role === "admin" || isParticipant);
}

async function joinMatch(matchId, userId) {
  validateObjectId(matchId, "match ID");
  validateObjectId(userId, "user");

  const session = await mongoose.startSession();
  let joinedMatch;

  try {
    await session.withTransaction(async () => {
      const match = await GameMatch.findById(matchId).session(session);

      if (!match) {
        throw createMatchError("Match not found", 404);
      }

      if (match.player1.toString() === userId.toString()) {
        throw createMatchError("You cannot join your own match", 400);
      }

      if (match.status !== MATCH_STATUS.ACTIVE || match.player2) {
        throw createMatchError("Match is no longer available", 409);
      }

      const user = await User.findById(userId)
        .select("_id fullName phone active isBlocked")
        .session(session);

      if (!user) {
        throw createMatchError("User not found", 404);
      }

      if (user.isBlocked) {
        throw createMatchError("This account is blocked", 403);
      }

      if (!user.active) {
        throw createMatchError("This account is inactive", 403);
      }

      const game = await Game.findOne({
        _id: match.gameId,
        isActive: true,
      }).session(session);

      if (!game) {
        throw createMatchError("This game is no longer active", 400);
      }

      const walletChange = await walletService.debitWallet({
        userId,
        amount: match.player1Amount,
        transactionType: TRANSACTION_TYPE.GAME_JOIN,
        remarks: "Match entry",
        referenceId: match._id.toString(),
        session,
      });

      const financials = calculateMatchFinancials(
        match.player1Amount,
        match.player1Amount
      );
      const now = new Date();

      joinedMatch = await GameMatch.findOneAndUpdate(
        {
          _id: match._id,
          status: MATCH_STATUS.ACTIVE,
          player2: null,
        },
        {
          $set: {
            player2: user._id,
            player2Name: user.fullName,
            player2Phone: user.phone,
            player2Amount: match.player1Amount,
            walletTransactionIdPlayer2: walletChange.transactionId,
            status: MATCH_STATUS.JOINED,
            joinedAt: now,
            prizePool: financials.totalPool,
            platformFee: financials.platformFee,
            winnerAmount: financials.winnerAmount,
          },
        },
        { new: true, runValidators: true, session }
      );

      if (!joinedMatch) {
        throw createMatchError("Match is no longer available", 409);
      }
    });

    return formatMatch(joinedMatch);
  } finally {
    await session.endSession();
  }
}

async function setRoomCode(matchId, userId, roomCode) {
  validateObjectId(matchId, "match ID");
  validateObjectId(userId, "user");

  if (typeof roomCode !== "string" || !roomCode.trim()) {
    throw createMatchError("Room code is required", 400);
  }

  const match = await GameMatch.findById(matchId);

  if (!match) {
    throw createMatchError("Match not found", 404);
  }

  if (match.player1.toString() !== userId.toString()) {
    throw createMatchError("Only the match creator can set the room code", 403);
  }

  if (match.status !== MATCH_STATUS.JOINED) {
    throw createMatchError("Room code can only be set after a player joins", 400);
  }

  const updatedMatch = await GameMatch.findOneAndUpdate(
    {
      _id: matchId,
      player1: userId,
      status: MATCH_STATUS.JOINED,
    },
    { $set: { roomCode: roomCode.trim() } },
    { new: true, runValidators: true }
  );

  if (!updatedMatch) {
    throw createMatchError("Match is no longer available", 409);
  }

  const game = await Game.findById(updatedMatch.gameId).select(
    "_id gameCode name imageUrl"
  );

  return formatMatch(updatedMatch, game);
}

async function leaveMatch(matchId, userId) {
  validateObjectId(matchId, "match ID");
  validateObjectId(userId, "user");

  const session = await mongoose.startSession();
  let updatedMatch;

  try {
    await session.withTransaction(async () => {
      const match = await GameMatch.findById(matchId).session(session);

      if (!match) {
        throw createMatchError("Match not found", 404);
      }

      if (!match.player2 || match.player2.toString() !== userId.toString()) {
        throw createMatchError("Only Player 2 can leave this match", 403);
      }

      if (match.roomCode) {
        throw createMatchError(
          "Player cannot leave after room code has been assigned",
          400
        );
      }

      if (match.status !== MATCH_STATUS.JOINED) {
        throw createMatchError("Match is no longer available", 400);
      }

      await walletService.creditWallet({
        userId,
        amount: match.player2Amount,
        transactionType: TRANSACTION_TYPE.GAME_REFUND,
        remarks: "Match entry refund",
        referenceId: match._id.toString(),
        session,
      });

      updatedMatch = await GameMatch.findOneAndUpdate(
        {
          _id: match._id,
          player2: userId,
          status: MATCH_STATUS.JOINED,
          roomCode: "",
        },
        {
          $set: {
            player2: null,
            player2Name: null,
            player2Phone: null,
            player2Amount: null,
            walletTransactionIdPlayer2: null,
            status: MATCH_STATUS.ACTIVE,
            joinedAt: null,
            prizePool: match.player1Amount,
            platformFee: 0,
            winnerAmount: 0,
          },
        },
        { new: true, runValidators: true, session }
      );

      if (!updatedMatch) {
        throw createMatchError("Match is no longer available", 409);
      }
    });

    return formatMatch(updatedMatch);
  } finally {
    await session.endSession();
  }
}

async function cancelMatch(matchId, userId) {
  validateObjectId(matchId, "match ID");
  validateObjectId(userId, "user");

  const session = await mongoose.startSession();
  let cancelledMatch;

  try {
    await session.withTransaction(async () => {
      const match = await GameMatch.findById(matchId).session(session);

      if (!match) {
        throw createMatchError("Match not found", 404);
      }

      if (match.player1.toString() !== userId.toString()) {
        throw createMatchError("Only the match creator can cancel", 403);
      }

      if (
        match.status !== MATCH_STATUS.ACTIVE ||
        match.player2 ||
        match.roomCode
      ) {
        throw createMatchError(
          "A match can only be cancelled before another player joins",
          400
        );
      }

      await walletService.creditWallet({
        userId,
        amount: match.player1Amount,
        transactionType: TRANSACTION_TYPE.GAME_REFUND,
        remarks: "Cancelled match entry refund",
        referenceId: match._id.toString(),
        session,
      });

      cancelledMatch = await GameMatch.findOneAndUpdate(
        {
          _id: match._id,
          player1: userId,
          status: MATCH_STATUS.ACTIVE,
          player2: null,
          roomCode: "",
        },
        {
          $set: {
            status: MATCH_STATUS.CANCELLED,
            cancelledAt: new Date(),
          },
        },
        { new: true, runValidators: true, session }
      );

      if (!cancelledMatch) {
        throw createMatchError("Match is no longer available", 409);
      }
    });

    return formatMatch(cancelledMatch);
  } finally {
    await session.endSession();
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
