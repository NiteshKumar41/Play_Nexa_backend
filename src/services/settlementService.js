const mongoose = require("mongoose");
const GameMatch = require("../models/GameMatch");
const User = require("../models/User");
const WalletTransaction = require("../models/WalletTransaction");
const { MATCH_STATUS } = require("../constants/matchStatus");
const { WINNER_CLAIM_STATUS } = require("../constants/winnerClaimStatus");
const { TRANSACTION_TYPE } = require("../constants/transactionTypes");
const { TRANSACTION_STATUS } = require("../constants/transactionStatus");
const walletService = require("./walletService");
const { calculateMatchFinancials } = require("./matchFinancialService");
const { roundMoney } = require("../utils/money");

const SETTLEMENT_ACTIONS = new Set([
  "DECLARE_WINNER",
  "REFUND_BOTH",
  "REJECT_CLAIM",
]);
const SETTLEABLE_STATUSES = [MATCH_STATUS.COMPLETED, MATCH_STATUS.DISPUTED];

function createSettlementError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function validateObjectId(value, label) {
  if (!mongoose.isValidObjectId(value)) {
    throw createSettlementError(`Invalid ${label}`, 400);
  }
}

function validateReason(reason, required) {
  if (reason === undefined || reason === null) {
    if (required) {
      throw createSettlementError("A rejection reason is required", 400);
    }
    return null;
  }

  if (typeof reason !== "string") {
    throw createSettlementError("Reason must be text", 400);
  }

  const trimmedReason = reason.trim();
  if ((required && trimmedReason.length < 5) || trimmedReason.length > 500) {
    throw createSettlementError(
      required
        ? "Rejection reason must be between 5 and 500 characters"
        : "Reason must be 500 characters or fewer",
      400
    );
  }

  return trimmedReason || null;
}

function validateMatchAmounts(match) {
  const { player1Amount, player2Amount, prizePool } = match;

  if (
    typeof player1Amount !== "number" ||
    !Number.isFinite(player1Amount) ||
    player1Amount <= 0 ||
    typeof player2Amount !== "number" ||
    !Number.isFinite(player2Amount) ||
    player2Amount <= 0
  ) {
    throw createSettlementError("Player entry amounts are invalid", 400);
  }

  let normalizedPlayer1Amount;
  let normalizedPlayer2Amount;
  try {
    normalizedPlayer1Amount = roundMoney(player1Amount);
    normalizedPlayer2Amount = roundMoney(player2Amount);
  } catch (error) {
    throw createSettlementError("Player entry amounts are invalid", 400);
  }
  if (normalizedPlayer1Amount <= 0 || normalizedPlayer2Amount <= 0) {
    throw createSettlementError("Player entry amounts are invalid", 400);
  }
  if (normalizedPlayer1Amount !== normalizedPlayer2Amount) {
    throw createSettlementError(
      "Player entry amounts are inconsistent",
      400
    );
  }

  let financials;
  try {
    financials = calculateMatchFinancials(
      normalizedPlayer1Amount,
      normalizedPlayer2Amount
    );
  } catch (error) {
    throw createSettlementError("Match financial calculation is invalid", 400);
  }
  let normalizedPrizePool;
  try {
    normalizedPrizePool = roundMoney(prizePool);
  } catch (error) {
    normalizedPrizePool = null;
  }
  if (
    typeof prizePool !== "number" ||
    !Number.isFinite(prizePool) ||
    normalizedPrizePool !== financials.totalPool
  ) {
    console.error(`Match financial data is inconsistent: ${match._id}`);
    throw createSettlementError(
      "Match financial data is inconsistent",
      400
    );
  }

  if (
    !Number.isFinite(financials.platformFee) ||
    !Number.isFinite(financials.winnerAmount) ||
    financials.platformFee < 0 ||
    financials.winnerAmount < 0
  ) {
    throw createSettlementError("Match financial calculation is invalid", 400);
  }

  return financials;
}

function validateSettleableMatch(match) {
  if (match.status === MATCH_STATUS.SETTLED) {
    throw createSettlementError("Match has already been settled", 409);
  }
  if (match.status === MATCH_STATUS.CANCELLED) {
    throw createSettlementError("Match has already been cancelled", 409);
  }
  if (!SETTLEABLE_STATUSES.includes(match.status)) {
    throw createSettlementError(
      "Only completed or disputed matches can be finalized",
      409
    );
  }
  if (!match.player1 || !match.player2) {
    throw createSettlementError("Match must have two players", 400);
  }
  if (
    match.winnerClaimStatus !== WINNER_CLAIM_STATUS.PENDING ||
    !match.winnerClaimedBy
  ) {
    throw createSettlementError("Match has no pending winner claim", 409);
  }
}

function validateAction(action) {
  if (!SETTLEMENT_ACTIONS.has(action)) {
    throw createSettlementError("Invalid settlement action", 400);
  }
}

async function findMatch(matchId, session) {
  const match = await GameMatch.findById(matchId).session(session);
  if (!match) throw createSettlementError("Match not found", 404);
  return match;
}

async function validatePlayersExist(match, session) {
  const players = await User.find({
    _id: { $in: [match.player1, match.player2] },
  })
    .select("_id")
    .session(session);
  if (players.length !== 2) {
    throw createSettlementError("Both match players must exist", 404);
  }
}

async function declareWinner(matchId, adminId, winnerUserId, reason) {
  validateObjectId(matchId, "match ID");
  validateObjectId(adminId, "admin");
  validateObjectId(winnerUserId, "winner");
  const settlementReason = validateReason(reason, false);
  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      const match = await findMatch(matchId, session);
      validateSettleableMatch(match);
      await validatePlayersExist(match, session);

      const winnerId = winnerUserId.toString();
      const player1Id = match.player1.toString();
      const player2Id = match.player2.toString();
      if (winnerId !== player1Id && winnerId !== player2Id) {
        throw createSettlementError(
          "Winner must be a participant in the match",
          400
        );
      }
      if (
        match.status === MATCH_STATUS.COMPLETED &&
        match.winnerClaimedBy.toString() !== winnerId
      ) {
        throw createSettlementError(
          "Winner must match the submitted claim unless the match is disputed",
          400
        );
      }

      const financials = validateMatchAmounts(match);
      const priorPayout = await WalletTransaction.findOne({
        transactionType: TRANSACTION_TYPE.GAME_WIN,
        referenceType: "MATCH_SETTLEMENT",
        referenceId: matchId.toString(),
        status: TRANSACTION_STATUS.SUCCESS,
      }).session(session);
      if (priorPayout) {
        throw createSettlementError("Match has already been settled", 409);
      }

      const winnerPhone =
        winnerId === player1Id ? match.player1Phone : match.player2Phone;
      const walletChange = await walletService.creditWallet({
        userId: winnerId,
        phone: winnerPhone,
        amount: financials.winnerAmount,
        transactionType: TRANSACTION_TYPE.GAME_WIN,
        remarks: "Match winner payout",
        referenceId: matchId.toString(),
        referenceType: "MATCH_SETTLEMENT",
        session,
      });

      const settledAt = new Date();
      const settledMatch = await GameMatch.findOneAndUpdate(
        {
          _id: matchId,
          status: match.status,
          settledAt: null,
        },
        {
          $set: {
            status: MATCH_STATUS.SETTLED,
            winnerPlayer: winnerId,
            winnerClaimStatus: WINNER_CLAIM_STATUS.APPROVED,
            prizePool: financials.totalPool,
            platformFee: financials.platformFee,
            winnerAmount: financials.winnerAmount,
            winnerTransactionId: walletChange.transactionId,
            settledAt,
            settledBy: adminId,
            settlementAction: "DECLARE_WINNER",
            settlementReason,
            rejectionReason: null,
            refundAmountPerPlayer: null,
            settlementWalletTransactionIds: [walletChange.transactionId],
          },
        },
        { new: true, runValidators: true, session }
      );

      if (!settledMatch) {
        throw createSettlementError("Match has already been settled", 409);
      }

      result = {
        matchId: settledMatch._id.toString(),
        status: settledMatch.status,
        winnerUserId: winnerId,
        winnerAmount: financials.winnerAmount,
        platformFee: financials.platformFee,
        settlementAction: "DECLARE_WINNER",
        newlyFinalized: true,
      };
    });

    return result;
  } finally {
    await session.endSession();
  }
}

async function refundBothPlayers(
  matchId,
  adminId,
  { action, reason } = {}
) {
  validateObjectId(matchId, "match ID");
  validateObjectId(adminId, "admin");
  validateAction(action);
  const settlementReason = validateReason(reason, action === "REJECT_CLAIM");
  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      const match = await findMatch(matchId, session);
      if (
        match.status === MATCH_STATUS.CANCELLED &&
        ["REFUND_BOTH", "REJECT_CLAIM"].includes(match.settlementAction)
      ) {
        throw createSettlementError("Match has already been refunded", 409);
      }
      validateSettleableMatch(match);
      await validatePlayersExist(match, session);
      validateMatchAmounts(match);

      const existingRefunds = await WalletTransaction.find({
        transactionType: TRANSACTION_TYPE.GAME_REFUND,
        referenceType: "MATCH_REFUND",
        referenceId: matchId.toString(),
        status: TRANSACTION_STATUS.SUCCESS,
      })
        .session(session)
        .select("_id");
      if (existingRefunds.length > 0) {
        throw createSettlementError(
          "Refund transactions already exist for this match",
          409
        );
      }

      const now = new Date();
      const player1Refund = await walletService.creditWallet({
        userId: match.player1.toString(),
        phone: match.player1Phone,
        amount: roundMoney(match.player1Amount),
        transactionType: TRANSACTION_TYPE.GAME_REFUND,
        remarks: "Match entry fee refund",
        referenceId: matchId.toString(),
        referenceType: "MATCH_REFUND",
        session,
      });
      const player2Refund = await walletService.creditWallet({
        userId: match.player2.toString(),
        phone: match.player2Phone,
        amount: roundMoney(match.player2Amount),
        transactionType: TRANSACTION_TYPE.GAME_REFUND,
        remarks: "Match entry fee refund",
        referenceId: matchId.toString(),
        referenceType: "MATCH_REFUND",
        session,
      });

      const cancelledMatch = await GameMatch.findOneAndUpdate(
        {
          _id: matchId,
          status: match.status,
          settledAt: null,
        },
        {
          $set: {
            status: MATCH_STATUS.CANCELLED,
            winnerPlayer: null,
            winnerClaimStatus: WINNER_CLAIM_STATUS.REJECTED,
            winnerAmount: 0,
            winnerTransactionId: null,
            platformFee: 0,
            cancelledAt: now,
            settledAt: now,
            settledBy: adminId,
            settlementAction: action,
            settlementReason,
            rejectionReason: action === "REJECT_CLAIM" ? settlementReason : null,
            refundAmountPerPlayer: roundMoney(match.player1Amount),
            settlementWalletTransactionIds: [
              player1Refund.transactionId,
              player2Refund.transactionId,
            ],
          },
        },
        { new: true, runValidators: true, session }
      );
      if (!cancelledMatch) {
        throw createSettlementError("Match finalization conflicted", 409);
      }

      result = {
        matchId: cancelledMatch._id.toString(),
        status: cancelledMatch.status,
        refundAmountPerPlayer: roundMoney(match.player1Amount),
        settlementAction: action,
        newlyFinalized: true,
      };
    });

    return result;
  } finally {
    await session.endSession();
  }
}

async function rejectWinnerClaim(matchId, adminId, reason) {
  return refundBothPlayers(matchId, adminId, {
    action: "REJECT_CLAIM",
    reason,
  });
}

async function settleMatch(matchId, adminId, settlementData) {
  if (!settlementData || typeof settlementData !== "object" || Array.isArray(settlementData)) {
    throw createSettlementError("Invalid settlement request", 400);
  }
  const allowedFields = ["action", "winnerUserId", "winnerId", "reason"];
  if (Object.keys(settlementData).some(field => !allowedFields.includes(field))) {
    throw createSettlementError("Settlement request contains unsupported fields", 400);
  }
  validateAction(settlementData.action);

  if (
    settlementData.winnerId !== undefined &&
    settlementData.winnerUserId !== undefined &&
    settlementData.winnerId.toString() !== settlementData.winnerUserId.toString()
  ) {
    throw createSettlementError("Conflicting winner IDs", 400);
  }
  const winnerId = settlementData.winnerId ?? settlementData.winnerUserId;

  console.log(
    `Settlement started: match=${matchId} admin=${adminId} action=${settlementData.action}`
  );

  let result;
  if (settlementData.action === "DECLARE_WINNER") {
    if (winnerId === undefined) {
      throw createSettlementError("winnerId is required", 400);
    }
    result = await declareWinner(
      matchId,
      adminId,
      winnerId,
      settlementData.reason
    );
  } else {
    if (winnerId !== undefined) {
      throw createSettlementError(
        "winnerUserId is only allowed when declaring a winner",
        400
      );
    }
    result =
      settlementData.action === "REJECT_CLAIM"
        ? await rejectWinnerClaim(matchId, adminId, settlementData.reason)
        : await refundBothPlayers(matchId, adminId, settlementData);
  }

  if (result.newlyFinalized) {
    console.log(
      `Settlement completed: match=${result.matchId} admin=${adminId} action=${result.settlementAction}`
    );
  }

  return result;
}

function validateListPagination(query = {}) {
  const page = Number(query.page ?? 1);
  const limit = Number(query.limit ?? 20);
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    throw createSettlementError("Page must be positive and limit must be 1-100", 400);
  }
  return { page, limit };
}

function formatQueueMatch(match) {
  return {
    id: match._id.toString(),
    game: match.gameId
      ? {
          id: match.gameId._id.toString(),
          gameCode: match.gameId.gameCode,
          name: match.gameId.name,
        }
      : null,
    player1: {
      id: match.player1.toString(),
      name: match.player1Name,
      phone: match.player1Phone,
      amount: match.player1Amount,
    },
    player2: match.player2
      ? {
          id: match.player2.toString(),
          name: match.player2Name,
          phone: match.player2Phone,
          amount: match.player2Amount,
        }
      : null,
    prizePool: match.prizePool,
    winnerPlayer: match.winnerPlayer?.toString() || null,
    winnerClaimedBy: match.winnerClaimedBy?.toString() || null,
    winnerClaimStatus: match.winnerClaimStatus,
    p1Screenshot: match.p1Screenshot,
    p2Screenshot: match.p2Screenshot,
    disputeReason: match.disputeReason,
    createdAt: match.createdAt,
    completedAt: match.completedAt,
    status: match.status,
  };
}

async function getAdminMatches(query = {}) {
  const { page, limit } = validateListPagination(query);
  const filter = {
    winnerClaimStatus: WINNER_CLAIM_STATUS.PENDING,
    $or: [
      { status: MATCH_STATUS.COMPLETED },
      { status: MATCH_STATUS.DISPUTED },
    ],
  };
  if (query.status === MATCH_STATUS.DISPUTED) {
    filter.status = MATCH_STATUS.DISPUTED;
    delete filter.$or;
  } else if (query.status !== undefined && query.status !== MATCH_STATUS.COMPLETED) {
    throw createSettlementError("Invalid match review status", 400);
  } else if (query.status === MATCH_STATUS.COMPLETED) {
    filter.status = MATCH_STATUS.COMPLETED;
    delete filter.$or;
  }

  const [matches, total] = await Promise.all([
    GameMatch.find(filter)
      .sort({ completedAt: 1, createdAt: 1, _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("gameId", "_id gameCode name")
      .lean(),
    GameMatch.countDocuments(filter),
  ]);
  return {
    matches: matches.map(formatQueueMatch),
    pagination: {
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    },
  };
}

async function getPendingSettlementQueue(query = {}) {
  const { page, limit } = validateListPagination(query);
  const filter = {
    winnerClaimStatus: WINNER_CLAIM_STATUS.PENDING,
    $or: [
      { status: MATCH_STATUS.COMPLETED },
      { status: MATCH_STATUS.DISPUTED },
    ],
  };
  const [matches, total] = await Promise.all([
    GameMatch.find(filter)
    .sort({ completedAt: 1, createdAt: 1, _id: 1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .populate("gameId", "_id gameCode name")
    .lean(),
    GameMatch.countDocuments(filter),
  ]);
  return {
    matches: matches.map(formatQueueMatch),
    pagination: {
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    },
  };
}

async function getSettlementHistory(query = {}) {
  const { page, limit } = validateListPagination(query);
  const filter = {
    status: { $in: [MATCH_STATUS.SETTLED, MATCH_STATUS.CANCELLED] },
  };
  const [matches, total] = await Promise.all([
    GameMatch.find(filter)
      .sort({ settledAt: -1, updatedAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("gameId", "_id gameCode name")
      .lean(),
    GameMatch.countDocuments(filter),
  ]);
  return {
    matches: matches.map(match => ({
    id: match._id.toString(),
    game: match.gameId
      ? { id: match.gameId._id.toString(), gameCode: match.gameId.gameCode, name: match.gameId.name }
      : null,
    status: match.status,
    settledBy: match.settledBy?.toString() || null,
    settlementAction: match.settlementAction,
    settlementReason: match.settlementReason,
    rejectionReason: match.rejectionReason,
    winnerPlayer: match.winnerPlayer?.toString() || null,
    winnerAmount: match.winnerAmount,
    platformFee: match.platformFee,
    refundAmountPerPlayer: match.refundAmountPerPlayer,
    settledAt: match.settledAt,
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

async function getSettlementDetail(matchId) {
  validateObjectId(matchId, "match ID");
  const match = await GameMatch.findById(matchId)
    .populate("gameId", "_id gameCode name")
    .populate("player1", "_id fullName phone")
    .populate("player2", "_id fullName phone")
    .populate("winnerPlayer", "_id fullName phone")
    .populate("settledBy", "_id fullName phone")
    .lean();
  if (!match) throw createSettlementError("Match not found", 404);

  const transactionIds = match.settlementWalletTransactionIds || [];
  const transactions = transactionIds.length
    ? await WalletTransaction.find({ _id: { $in: transactionIds } })
        .select("_id walletId userId phone transactionType amount balanceBefore balanceAfter status remarks referenceType referenceId createdAt")
        .lean()
    : await WalletTransaction.find({
        referenceId: match._id.toString(),
        referenceType: { $in: ["MATCH_SETTLEMENT", "MATCH_REFUND"] },
      })
        .select("_id walletId userId phone transactionType amount balanceBefore balanceAfter status remarks referenceType referenceId createdAt")
        .lean();

  return {
    match: {
      id: match._id.toString(),
      game: match.gameId
        ? { id: match.gameId._id.toString(), gameCode: match.gameId.gameCode, name: match.gameId.name }
        : null,
      player1: match.player1
        ? { id: match.player1._id.toString(), name: match.player1.fullName, phone: match.player1.phone, amount: match.player1Amount }
        : null,
      player2: match.player2
        ? { id: match.player2._id.toString(), name: match.player2.fullName, phone: match.player2.phone, amount: match.player2Amount }
        : null,
      status: match.status,
      winnerPlayer: match.winnerPlayer
        ? { id: match.winnerPlayer._id.toString(), name: match.winnerPlayer.fullName, phone: match.winnerPlayer.phone }
        : null,
      winnerClaimedBy: match.winnerClaimedBy?.toString() || null,
      winnerClaimStatus: match.winnerClaimStatus,
      winnerClaimRemarks: match.winnerClaimRemarks,
      p1Screenshot: match.p1Screenshot,
      p2Screenshot: match.p2Screenshot,
      disputeReason: match.disputeReason,
      disputeClaimedBy: match.disputeClaimedBy?.toString() || null,
      financials: {
        player1Amount: match.player1Amount,
        player2Amount: match.player2Amount,
        prizePool: match.prizePool,
        platformFee: match.platformFee,
        winnerAmount: match.winnerAmount,
        refundAmountPerPlayer: match.refundAmountPerPlayer,
      },
      settlement: {
        settledBy: match.settledBy
          ? { id: match.settledBy._id.toString(), name: match.settledBy.fullName, phone: match.settledBy.phone }
          : null,
        settledAt: match.settledAt,
        settlementAction: match.settlementAction,
        settlementReason: match.settlementReason,
        rejectionReason: match.rejectionReason,
      },
      createdAt: match.createdAt,
      completedAt: match.completedAt,
      cancelledAt: match.cancelledAt,
    },
    walletTransactions: transactions.map(transaction => ({
      id: transaction._id.toString(),
      walletId: transaction.walletId.toString(),
      userId: transaction.userId.toString(),
      phone: transaction.phone,
      transactionType: transaction.transactionType,
      amount: transaction.amount,
      balanceBefore: transaction.balanceBefore,
      balanceAfter: transaction.balanceAfter,
      status: transaction.status,
      remarks: transaction.remarks,
      referenceType: transaction.referenceType,
      referenceId: transaction.referenceId,
      createdAt: transaction.createdAt,
    })),
  };
}

module.exports = {
  settleMatch,
  declareWinner,
  refundBothPlayers,
  rejectWinnerClaim,
  getAdminMatches,
  getPendingSettlementQueue,
  getSettlementHistory,
  getSettlementDetail,
};
