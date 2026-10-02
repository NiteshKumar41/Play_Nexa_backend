const resultService = require("../services/resultService");
const {
  emitResultSubmitted,
  emitDisputeSubmitted,
} = require("../socket/socketEmitter");

function formatSubmissionMatch(match, includeWinner) {
  const formattedMatch = {
    id: match.id,
    status: match.status,
    winnerClaimStatus: match.winnerClaimStatus,
  };

  if (includeWinner) {
    formattedMatch.winnerClaimedBy = match.winnerClaimedBy;
  }

  return formattedMatch;
}

async function submitWinnerClaim(request, response, next) {
  try {
    if (request.body?.winnerClaim !== "true") {
      const error = new Error("winnerClaim must be true");
      error.statusCode = 400;
      throw error;
    }

    const match = await resultService.submitWinnerClaim(
      request.params.matchId,
      request.user.id,
      request.file,
      request.body?.remarks
    );
    emitResultSubmitted(match);

    return response.status(200).json({
      success: true,
      message: "Winner claim submitted successfully",
      data: { match: formatSubmissionMatch(match, true) },
    });
  } catch (error) {
    return next(error);
  }
}

async function submitDispute(request, response, next) {
  try {
    const match = await resultService.submitDispute(
      request.params.matchId,
      request.user.id,
      request.body?.reason,
      request.file
    );
    emitDisputeSubmitted(match);

    return response.status(200).json({
      success: true,
      message: "Dispute submitted successfully",
      data: { match: formatSubmissionMatch(match, false) },
    });
  } catch (error) {
    return next(error);
  }
}

async function getPendingResults(request, response, next) {
  try {
    const matches = await resultService.getPendingResults();
    return response.status(200).json({
      success: true,
      data: { matches },
    });
  } catch (error) {
    return next(error);
  }
}

async function getResultByMatchId(request, response, next) {
  try {
    const match = await resultService.getResultByMatchId(
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

async function getEvidenceFile(request, response, next) {
  try {
    const evidence = await resultService.getEvidenceFile(
      request.params.matchId,
      request.params.fileName,
      request.user.id,
      request.user.role
    );
    response.set("Content-Type", evidence.contentType);
    response.set("Cache-Control", "private, no-store");
    response.set("X-Content-Type-Options", "nosniff");
    return response.send(evidence.buffer);
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  submitWinnerClaim,
  submitDispute,
  getPendingResults,
  getResultByMatchId,
  getEvidenceFile,
};
