const depositService = require("../services/depositService");
const {
  emitDepositApproved,
  emitDepositRejected,
} = require("../socket/socketEmitter");

async function getPendingDeposits(request, response, next) {
  try {
    const data = await depositService.getPendingDeposits(request.query);
    return response.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return next(error);
  }
}

async function getAdminDeposits(request, response, next) {
  try {
    const data = await depositService.getAdminDeposits(request.query);
    return response.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
}

async function getDepositDetail(request, response, next) {
  try {
    const deposit = await depositService.getDepositDetail(
      request.params.transactionId
    );
    return response.status(200).json({
      success: true,
      data: { deposit },
    });
  } catch (error) {
    return next(error);
  }
}

async function approveDeposit(request, response, next) {
  try {
    const deposit = await depositService.approveDeposit(
      request.params.transactionId,
      request.user.id
    );
    emitDepositApproved(deposit);
    return response.status(200).json({
      success: true,
      message: "Deposit approved successfully",
      data: { deposit },
    });
  } catch (error) {
    return next(error);
  }
}

async function rejectDeposit(request, response, next) {
  try {
    const deposit = await depositService.rejectDeposit(
      request.params.transactionId,
      request.user.id,
      request.body?.reason
    );
    emitDepositRejected(deposit);
    return response.status(200).json({
      success: true,
      message: "Deposit rejected",
      data: { deposit },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getPendingDeposits,
  getAdminDeposits,
  getDepositDetail,
  approveDeposit,
  rejectDeposit,
};
