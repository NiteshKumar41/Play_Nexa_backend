const walletService = require("../services/walletService");

async function getWallet(request, response, next) {
  try {
    const wallet = await walletService.getWallet(request.user.id);

    return response.status(200).json({
      success: true,
      data: wallet,
    });
  } catch (error) {
    return next(error);
  }
}

async function getTransactions(request, response, next) {
  try {
    const page = Number(request.query.page ?? 1);
    const limit = Number(request.query.limit ?? 10);
    const data = await walletService.getTransactions(request.user.id, {
      page,
      limit,
    });

    return response.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getWallet,
  getTransactions,
};
