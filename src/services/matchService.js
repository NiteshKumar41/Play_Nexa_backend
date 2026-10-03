const mongoose = require("mongoose");
const Game = require("../models/Game");
const GameMatch = require("../models/GameMatch");
const WalletTransaction = require("../models/WalletTransaction");
const User = require("../models/User");
const { MATCH_STATUS } = require("../constants/matchStatus");
const { TRANSACTION_TYPE } = require("../constants/transactionTypes");
const { TRANSACTION_STATUS } = require("../constants/transactionStatus");
const walletService = require("./walletService");
const { calculateMatchFinancials } = require("../utils/matchFinancials");
const { addMoney, roundMoney } = require("../utils/money");

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

  try {
    const normalizedEntryFee = roundMoney(entryFee);
    if (normalizedEntryFee <= 0) {
      throw createMatchError("Entry fee must be at least 0.01", 400);
    }
    return normalizedEntryFee;
  } catch (error) {
    if (error.statusCode) throw error;
    throw createMatchError("Entry fee is outside the supported range", 400);
  }
}

function validateClientRequestId(clientRequestId) {
  if (clientRequestId === undefined || clientRequestId === null || clientRequestId === "") {
    return null;
  }

  if (
    typeof clientRequestId !== "string" ||
    clientRequestId.trim().length < 1 ||
    clientRequestId.trim().length > 128
  ) {
    throw createMatchError("Invalid client request ID", 400);
  }

  return clientRequestId.trim();
}

function isSameCreateRequest(match, { gameId, entryFee, userId }) {
  try {
    return (
      match.player1.toString() === userId.toString() &&
      match.gameId.toString() === gameId.toString() &&
      roundMoney(match.player1Amount) === roundMoney(entryFee)
    );
  } catch {
    return false;
  }
}

function formatMatch(
  match,
  game,
  { includeEvidence = false, includeRoomCode = false } = {}
) {
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
    roomCode: includeRoomCode ? match.roomCode : undefined,
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
  const { gameId, entryFee, clientRequestId: rawClientRequestId } = getRequestFields(matchData, [
    "gameId",
    "entryFee",
    "clientRequestId",
  ]);
  validateObjectId(userId, "user");
  validateObjectId(gameId, "game ID");
  const normalizedEntryFee = validateEntryFee(entryFee);
  const clientRequestId = validateClientRequestId(rawClientRequestId);
  if (!clientRequestId) {
    throw createMatchError("clientRequestId is required for match creation", 400);
  }

  if (clientRequestId) {
    const existingMatch = await GameMatch.findOne({
      player1: userId,
      clientRequestId,
    });

    if (existingMatch) {
      if (!isSameCreateRequest(existingMatch, {
        gameId,
        entryFee: normalizedEntryFee,
        userId,
      })) {
        throw createMatchError(
          "This client request ID was already used for a different match",
          409
        );
      }

      return formatMatch(existingMatch);
    }
  }

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
        amount: normalizedEntryFee,
        transactionType: TRANSACTION_TYPE.GAME_CREATE,
        remarks: "Match entry reserved",
        referenceId: matchId.toString(),
        referenceType: "MATCH",
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
            player1Amount: normalizedEntryFee,
            player2: null,
            player2Name: null,
            player2Phone: null,
            player2Amount: null,
            walletTransactionIdPlayer1: walletChange.transactionId,
            walletTransactionIdPlayer2: null,
            status: MATCH_STATUS.ACTIVE,
            roomCode: "",
            prizePool: normalizedEntryFee,
            platformFee: 0,
            winnerAmount: 0,
            createdBy: user._id,
            createdName: user.fullName,
            clientRequestId,
          },
        ],
        { session }
      );
    });

    return formatMatch(createdMatch);
  } catch (error) {
    if (error?.code === 11000 && clientRequestId) {
      const existingMatch = await GameMatch.findOne({
        player1: userId,
        clientRequestId,
      });

      if (existingMatch) {
        if (!isSameCreateRequest(existingMatch, {
          gameId,
          entryFee: normalizedEntryFee,
          userId,
        })) {
          throw createMatchError(
            "This client request ID was already used for a different match",
            409
          );
        }

        return formatMatch(existingMatch);
      }
    }

    throw error;
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
  const canViewPrivateDetails = role === "admin" || isParticipant;

  if (!canViewPrivateDetails) {
    throw createMatchError("You are not allowed to view this match", 403);
  }

  return formatMatch(match, game, {
    includeEvidence: canViewPrivateDetails,
    includeRoomCode: canViewPrivateDetails,
  });
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

      if (match.joinDeadline && new Date() >= match.joinDeadline) {
        throw createMatchError("Match joining deadline has passed", 409);
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
        isOpen: true,
      }).session(session);

      if (!game) {
        throw createMatchError("This game is not open for matchmaking", 400);
      }

      const walletChange = await walletService.debitWallet({
        userId,
        amount: match.player1Amount,
        transactionType: TRANSACTION_TYPE.GAME_JOIN,
        remarks: "Match entry",
        referenceId: match._id.toString(),
        referenceType: "MATCH",
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

  const normalizedRoomCode = roomCode.trim();

  if (normalizedRoomCode.length > 64) {
    throw createMatchError("Room code must be 64 characters or fewer", 400);
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
    { $set: { roomCode: normalizedRoomCode } },
    { new: true, runValidators: true }
  );

  if (!updatedMatch) {
    throw createMatchError("Match is no longer available", 409);
  }

  const game = await Game.findById(updatedMatch.gameId).select(
    "_id gameCode name imageUrl"
  );

  return formatMatch(updatedMatch, game, { includeRoomCode: true });
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

      await walletService.getSuccessfulMatchEntry({
        walletTransactionId: match.walletTransactionIdPlayer2,
        userId,
        matchId: match._id,
        transactionType: TRANSACTION_TYPE.GAME_JOIN,
        amount: match.player2Amount,
        session,
      });

      await walletService.creditWallet({
        userId,
        amount: match.player2Amount,
        transactionType: TRANSACTION_TYPE.GAME_REFUND,
        remarks: "Match entry refund",
        referenceId: match._id.toString(),
        referenceType: "MATCH_REFUND",
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

      await walletService.getSuccessfulMatchEntry({
        walletTransactionId: match.walletTransactionIdPlayer1,
        userId: match.player1,
        matchId: match._id,
        transactionType: TRANSACTION_TYPE.GAME_CREATE,
        amount: match.player1Amount,
        session,
      });

      const matchReferenceId = match._id.toString();
      const eligiblePlayerId = match.player1.toString();
      const originalEntryFee = roundMoney(match.player1Amount);
      const successfulGameWin = await WalletTransaction.findOne({
        userId: eligiblePlayerId,
        transactionType: TRANSACTION_TYPE.GAME_WIN,
        referenceId: matchReferenceId,
        status: TRANSACTION_STATUS.SUCCESS,
      })
        .select("_id")
        .session(session);

      if (successfulGameWin) {
        throw createMatchError(
          "A successful game settlement already exists for this match",
          409
        );
      }

      const successfulRefunds = await WalletTransaction.find({
        userId: eligiblePlayerId,
        transactionType: TRANSACTION_TYPE.GAME_REFUND,
        referenceId: matchReferenceId,
        status: TRANSACTION_STATUS.SUCCESS,
      })
        .select("amount")
        .session(session);
      const totalSuccessfulRefundAmount = successfulRefunds.reduce(
        (total, refund) => addMoney(total, roundMoney(refund.amount)),
        0
      );

      if (successfulRefunds.length > 0) {
        throw createMatchError("A refund already exists for this match", 409);
      }

      const refundAmount = originalEntryFee;
      if (
        addMoney(totalSuccessfulRefundAmount, refundAmount) > originalEntryFee
      ) {
        throw createMatchError(
          "The match refund exceeds the original entry fee",
          409
        );
      }

      await walletService.creditWallet({
        userId: eligiblePlayerId,
        amount: refundAmount,
        transactionType: TRANSACTION_TYPE.GAME_REFUND,
        remarks: "Cancelled match entry refund",
        referenceId: matchReferenceId,
        referenceType: "MATCH_REFUND",
        session,
      });

      cancelledMatch = await GameMatch.findOneAndUpdate(
        {
          _id: match._id,
          player1: match.player1,
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
