const withdrawalService = require("../services/withdrawalService");

async function createWithdrawal(request, response, next) {
  try {
    const withdrawal = await withdrawalService.createWithdrawal(
      request.user.id,
      request.body
    );
    return response.status(201).json({
      success: true,
      message: "Withdrawal request submitted successfully",
      data: withdrawal,
    });
  } catch (error) {
    return next(error);
  }
}

async function getUserWithdrawals(request, response, next) {
  try {
    const data = await withdrawalService.getUserWithdrawals(
      request.user.id,
      request.query
    );
    return response.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
}

module.exports = { createWithdrawal, getUserWithdrawals };
