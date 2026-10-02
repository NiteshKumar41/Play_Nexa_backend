const mongoose = require("mongoose");
const Game = require("../models/Game");
const GameMatch = require("../models/GameMatch");
const { MATCH_STATUS } = require("../constants/matchStatus");
const { WINNER_CLAIM_STATUS } = require("../constants/winnerClaimStatus");
const fileStorage = require("../utils/fileStorage");

function createResultError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function validateObjectId(value, label) {
  if (!mongoose.isValidObjectId(value)) {
    throw createResultError(`Invalid ${label}`, 400);
  }
}

function isParticipant(match, userId) {
  return (
    match.player1.toString() === userId.toString() ||
    match.player2?.toString() === userId.toString()
  );
}

function formatResult(match, game) {
  return {
    id: match._id.toString(),
    game: game
      ? {
          id: game._id.toString(),
          gameCode: game.gameCode,
          name: game.name,
        }
      : null,
    player1: match.player1.toString(),
    player1Name: match.player1Name,
    player2: match.player2?.toString() || null,
    player2Name: match.player2Name,
    p1Screenshot: match.p1Screenshot,
    p2Screenshot: match.p2Screenshot,
    winnerPlayer: match.winnerPlayer?.toString() || null,
    winnerClaimedBy: match.winnerClaimedBy?.toString() || null,
    winnerClaimStatus: match.winnerClaimStatus,
    winnerClaimRemarks: match.winnerClaimRemarks,
    disputeReason: match.disputeReason,
    disputeClaimedBy: match.disputeClaimedBy?.toString() || null,
    status: match.status,
    prizePool: match.prizePool,
    platformFee: match.platformFee,
    winnerAmount: match.winnerAmount,
    createdAt: match.createdAt,
    completedAt: match.completedAt,
  };
}

async function submitWinnerClaim(matchId, userId, screenshotFile, remarks) {
  validateObjectId(matchId, "match ID");
  validateObjectId(userId, "user");
  if (!screenshotFile) {
    throw createResultError("Screenshot is required", 400);
  }

  const match = await GameMatch.findById(matchId);
  if (!match) throw createResultError("Match not found", 404);
  if (!isParticipant(match, userId)) {
    throw createResultError("Only match participants can submit a result", 403);
  }
  if (
    match.winnerClaimStatus === WINNER_CLAIM_STATUS.PENDING ||
    match.winnerClaimedBy
  ) {
    throw createResultError("Winner claim already submitted for this match", 409);
  }
  if (match.status === MATCH_STATUS.DISPUTED) {
    throw createResultError("A winner claim cannot be submitted after a dispute", 409);
  }
  if (match.status !== MATCH_STATUS.JOINED || !match.player1 || !match.player2) {
    throw createResultError("A result can only be submitted for a joined match", 400);
  }
  if (typeof remarks === "string" && remarks.trim().length > 1000) {
    throw createResultError("Remarks must be 1000 characters or fewer", 400);
  }

  const fileName = await fileStorage.saveFile(screenshotFile);

  try {
    const screenshotField =
      match.player1.toString() === userId.toString()
        ? "p1Screenshot"
        : "p2Screenshot";
    if (match[screenshotField]) {
      throw createResultError(
        "This player has already submitted screenshot evidence",
        409
      );
    }
    const updatedMatch = await GameMatch.findOneAndUpdate(
      {
        _id: matchId,
        status: MATCH_STATUS.JOINED,
        winnerClaimStatus: null,
        winnerClaimedBy: null,
      },
      {
        $set: {
          [screenshotField]: fileStorage.getFileUrl(matchId, fileName),
          winnerPlayer: userId,
          winnerClaimedBy: userId,
          winnerClaimStatus: WINNER_CLAIM_STATUS.PENDING,
          winnerClaimRemarks: remarks?.trim() || null,
          status: MATCH_STATUS.COMPLETED,
          completedAt: new Date(),
        },
      },
      { new: true, runValidators: true }
    );

    if (!updatedMatch) {
      throw createResultError(
        "Winner claim already submitted for this match",
        409
      );
    }

    return formatResult(updatedMatch);
  } catch (error) {
    await fileStorage.deleteFile(fileName);
    throw error;
  }
}

async function submitDispute(matchId, userId, disputeReason, screenshotFile) {
  validateObjectId(matchId, "match ID");
  validateObjectId(userId, "user");
  if (typeof disputeReason !== "string" || !disputeReason.trim()) {
    throw createResultError("Dispute reason is required", 400);
  }
  if (disputeReason.trim().length > 2000) {
    throw createResultError("Dispute reason must be 2000 characters or fewer", 400);
  }
  if (!screenshotFile) {
    throw createResultError("Screenshot is required", 400);
  }

  const match = await GameMatch.findById(matchId);
  if (!match) throw createResultError("Match not found", 404);
  if (!isParticipant(match, userId)) {
    throw createResultError("Only match participants can dispute a result", 403);
  }
  if (match.status === MATCH_STATUS.DISPUTED) {
    throw createResultError("A dispute is already active for this match", 409);
  }
  if (match.winnerClaimedBy?.toString() === userId.toString()) {
    throw createResultError("You cannot dispute your own winner claim", 400);
  }
  if (
    match.status !== MATCH_STATUS.COMPLETED ||
    match.winnerClaimStatus !== WINNER_CLAIM_STATUS.PENDING ||
    !match.winnerClaimedBy
  ) {
    throw createResultError("There is no pending winner claim to dispute", 400);
  }

  const fileName = await fileStorage.saveFile(screenshotFile);

  try {
    const screenshotField =
      match.player1.toString() === userId.toString()
        ? "p1Screenshot"
        : "p2Screenshot";
    const updatedMatch = await GameMatch.findOneAndUpdate(
      {
        _id: matchId,
        status: MATCH_STATUS.COMPLETED,
        winnerClaimStatus: WINNER_CLAIM_STATUS.PENDING,
        winnerClaimedBy: { $ne: userId },
      },
      {
        $set: {
          [screenshotField]: fileStorage.getFileUrl(matchId, fileName),
          status: MATCH_STATUS.DISPUTED,
          disputeClaimedBy: userId,
          disputeReason: disputeReason.trim(),
        },
      },
      { new: true, runValidators: true }
    );

    if (!updatedMatch) {
      throw createResultError("A dispute is already active for this match", 409);
    }

    return formatResult(updatedMatch);
  } catch (error) {
    await fileStorage.deleteFile(fileName);
    throw error;
  }
}

async function getResultByMatchId(matchId, userId, role) {
  validateObjectId(matchId, "match ID");
  validateObjectId(userId, "user");

  const match = await GameMatch.findById(matchId);
  if (!match) throw createResultError("Match not found", 404);
  if (role !== "admin" && !isParticipant(match, userId)) {
    throw createResultError("You are not allowed to access this result", 403);
  }

  const game = await Game.findById(match.gameId).select("_id gameCode name");
  return formatResult(match, game);
}

async function getPendingResults(query = {}) {
  const page = Number(query.page ?? 1);
  const limit = Number(query.limit ?? 20);
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    throw createResultError("Page must be positive and limit must be 1-100", 400);
  }
  const filter = {
    status: { $in: [MATCH_STATUS.COMPLETED, MATCH_STATUS.DISPUTED] },
  };
  const [matches, total] = await Promise.all([
    GameMatch.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("gameId", "_id gameCode name")
      .lean(),
    GameMatch.countDocuments(filter),
  ]);

  return {
    matches: matches.map(match =>
      formatResult(
        {
          ...match,
          _id: match._id,
          gameId: match.gameId?._id || match.gameId,
        },
        match.gameId
      )
    ),
    pagination: {
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    },
  };
}

async function getEvidenceFile(matchId, fileName, userId, role) {
  validateObjectId(matchId, "match ID");
  validateObjectId(userId, "user");
  const match = await GameMatch.findById(matchId).select(
    "player1 player2 p1Screenshot p2Screenshot"
  );

  if (!match) throw createResultError("Match not found", 404);
  if (role !== "admin" && !isParticipant(match, userId)) {
    throw createResultError("You are not allowed to access this evidence", 403);
  }

  const expectedUrls = [match.p1Screenshot, match.p2Screenshot];
  if (!expectedUrls.includes(fileStorage.getFileUrl(matchId, fileName))) {
    throw createResultError("Evidence file not found", 404);
  }

  return {
    buffer: await fileStorage.readFile(fileName),
    contentType: fileStorage.getFileContentType(fileName),
  };
}

module.exports = {
  submitWinnerClaim,
  submitDispute,
  getPendingResults,
  getResultByMatchId,
  getEvidenceFile,
};
