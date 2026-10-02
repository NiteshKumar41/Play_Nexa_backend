const withdrawalService = require("../services/withdrawalService");
const {
  emitWithdrawalSuccess,
  emitWithdrawalFailed,
} = require("../socket/socketEmitter");

async function getPendingWithdrawals(request, response, next) {
  try {
    const data = await withdrawalService.getPendingWithdrawals(request.query);
    return response.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return next(error);
  }
}

async function getAdminWithdrawals(request, response, next) {
  try {
    const data = await withdrawalService.getAdminWithdrawals(request.query);
    return response.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
}

async function getWithdrawalDetail(request, response, next) {
  try {
    const withdrawal = await withdrawalService.getWithdrawalById(
      request.params.transactionId
    );
    return response.status(200).json({
      success: true,
      data: { withdrawal },
    });
  } catch (error) {
    return next(error);
  }
}

async function markWithdrawalSuccess(request, response, next) {
  try {
    const withdrawal = await withdrawalService.markWithdrawalSuccess(
      request.params.transactionId,
      request.user.id,
      request.body
    );
    emitWithdrawalSuccess(withdrawal);
    return response.status(200).json({
      success: true,
      message: "Withdrawal payout marked successful",
      data: { withdrawal },
    });
  } catch (error) {
    return next(error);
  }
}

async function rejectWithdrawal(request, response, next) {
  try {
    const withdrawal = await withdrawalService.rejectWithdrawal(
      request.params.transactionId,
      request.user.id,
      request.body?.reason
    );
    emitWithdrawalFailed(withdrawal);
    return response.status(200).json({
      success: true,
      message: "Withdrawal rejected and wallet refunded",
      data: { withdrawal },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getPendingWithdrawals,
  getAdminWithdrawals,
  getWithdrawalDetail,
  markWithdrawalSuccess,
  rejectWithdrawal,
};
