const settlementService = require("../services/settlementService");
const {
  emitMatchSettled,
  emitMatchRefunded,
  emitMatchClaimRejected,
} = require("../socket/socketEmitter");

async function settleMatch(request, response, next) {
  try {
    const result = await settlementService.settleMatch(
      request.params.matchId,
      request.user.id,
      request.body
    );

    if (result.newlyFinalized) {
      if (result.settlementAction === "DECLARE_WINNER") {
        emitMatchSettled(result);
      } else if (result.settlementAction === "REJECT_CLAIM") {
        emitMatchClaimRejected(result);
      } else {
        emitMatchRefunded(result);
      }
    }

    const isPayout = result.settlementAction === "DECLARE_WINNER";
    const message = result.newlyFinalized
      ? isPayout
        ? "Match settled successfully"
        : result.settlementAction === "REJECT_CLAIM"
          ? "Winner claim rejected and both players refunded"
          : "Match refunded successfully"
      : "Match has already been refunded";
    const data = isPayout
      ? {
          matchId: result.matchId,
          status: result.status,
          winnerUserId: result.winnerUserId,
          winnerAmount: result.winnerAmount,
          platformFee: result.platformFee,
        }
      : {
          matchId: result.matchId,
          status: result.status,
          refundAmountPerPlayer: result.refundAmountPerPlayer,
        };

    return response.status(200).json({ success: true, message, data });
  } catch (error) {
    return next(error);
  }
}

async function getPendingSettlementQueue(request, response, next) {
  try {
    const data = await settlementService.getPendingSettlementQueue(request.query);
    return response.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return next(error);
  }
}

async function getSettlementHistory(request, response, next) {
  try {
    const data = await settlementService.getSettlementHistory(request.query);
    return response.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return next(error);
  }
}

async function getSettlementDetail(request, response, next) {
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

module.exports = {
  settleMatch,
  getPendingSettlementQueue,
  getSettlementHistory,
  getSettlementDetail,
};
