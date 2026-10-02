const settlementService = require("../services/settlementService");
const {
  emitMatchSettled,
  emitMatchRefunded,
  emitMatchClaimRejected,
} = require("../socket/socketEmitter");

function validateRequestFields(body, allowedFields) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some(field => !allowedFields.includes(field))
  ) {
    const error = new Error("Invalid match review request");
    error.statusCode = 400;
    throw error;
  }
}

async function getPendingMatches(request, response, next) {
  try {
    const data = await settlementService.getAdminMatches({
      ...request.query,
      status: "COMPLETED",
    });
    return response.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
}

async function getDisputedMatches(request, response, next) {
  try {
    const data = await settlementService.getAdminMatches({
      ...request.query,
      status: "DISPUTED",
    });
    return response.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
}

async function getMatch(request, response, next) {
  try {
    const settlement = await settlementService.getSettlementDetail(
      request.params.matchId
    );
    return response.status(200).json({
      success: true,
      data: settlement,
    });
  } catch (error) {
    return next(error);
  }
}

async function finalizeMatch(request, response, next, action) {
  try {
    const allowedFields =
      action === "DECLARE_WINNER"
        ? ["winnerPlayerId", "reason"]
        : ["reason"];
    validateRequestFields(request.body || {}, allowedFields);

    const serviceInput = {
      action,
      ...(action === "DECLARE_WINNER"
        ? { winnerUserId: request.body.winnerPlayerId }
        : {}),
      ...(request.body.reason !== undefined
        ? { reason: request.body.reason }
        : {}),
    };
    const result = await settlementService.settleMatch(
      request.params.matchId,
      request.user.id,
      serviceInput
    );

    if (result.newlyFinalized) {
      if (action === "DECLARE_WINNER") {
        emitMatchSettled(result);
      } else if (action === "REJECT_CLAIM") {
        emitMatchClaimRejected(result);
      } else {
        emitMatchRefunded(result);
      }
    }

    const message =
      action === "DECLARE_WINNER"
        ? "Match settled successfully"
        : action === "REJECT_CLAIM"
          ? "Winner claim rejected and both players refunded"
          : "Match refunded successfully";
    return response.status(200).json({
      success: true,
      message,
      data: result,
    });
  } catch (error) {
    return next(error);
  }
}

function declareWinner(request, response, next) {
  return finalizeMatch(request, response, next, "DECLARE_WINNER");
}

function refundMatch(request, response, next) {
  return finalizeMatch(request, response, next, "REFUND_BOTH");
}

function rejectClaim(request, response, next) {
  return finalizeMatch(request, response, next, "REJECT_CLAIM");
}

module.exports = {
  getPendingMatches,
  getDisputedMatches,
  getMatch,
  declareWinner,
  refundMatch,
  rejectClaim,
};
