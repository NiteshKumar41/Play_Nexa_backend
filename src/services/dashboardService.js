const User = require("../models/User");
const Game = require("../models/Game");
const GameMatch = require("../models/GameMatch");
const PlatformCommission = require("../models/PlatformCommission");
const WalletTransaction = require("../models/WalletTransaction");
const SupportTicket = require("../models/SupportTicket");
const { TRANSACTION_TYPE } = require("../constants/transactionTypes");
const { TRANSACTION_STATUS } = require("../constants/transactionStatus");
const { MATCH_STATUS } = require("../constants/matchStatus");
const dateUtils = require("../utils/date");

function createDashboardError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function getSummary(query = {}) {
  const dateRange = dateUtils.getISTDateRange(query.from, query.to);
  const financialFilter = {};
  if (dateRange) financialFilter.createdAt = dateRange;

  const [
    totalUsers,
    activeUsers,
    blockedUsers,
    totalGames,
    activeGames,
    totalMatches,
    completedMatches,
    pendingDeposits,
    pendingWithdrawals,
    openSupportTickets,
    financialTotals,
    platformCommissionTotals,
    legacyPlatformFeeTotals,
  ] = await Promise.all([
    User.countDocuments({}),
    User.countDocuments({ active: true }),
    User.countDocuments({ isBlocked: true }),
    Game.countDocuments({}),
    Game.countDocuments({ isActive: true }),
    GameMatch.countDocuments({}),
    GameMatch.countDocuments({
      status: { $in: [MATCH_STATUS.COMPLETED, MATCH_STATUS.SETTLED] },
    }),
    WalletTransaction.countDocuments({
      transactionType: TRANSACTION_TYPE.ADD_MONEY,
      status: TRANSACTION_STATUS.PENDING,
    }),
    WalletTransaction.countDocuments({
      transactionType: TRANSACTION_TYPE.WITHDRAW,
      status: TRANSACTION_STATUS.INITIATED,
    }),
    SupportTicket.countDocuments({ status: { $in: ["OPEN", "IN_PROGRESS"] } }),
    WalletTransaction.aggregate([
      {
        $match: {
          ...financialFilter,
          transactionType: {
            $in: [TRANSACTION_TYPE.ADD_MONEY, TRANSACTION_TYPE.WITHDRAW],
          },
          status: TRANSACTION_STATUS.SUCCESS,
        },
      },
      {
        $group: {
          _id: "$transactionType",
          amount: { $sum: "$amount" },
        },
      },
    ]),
    PlatformCommission.aggregate([
      {
        $match: {
          accountingStatus: "RECORDED",
          ...(dateRange ? { createdAt: dateRange } : {}),
        },
      },
      {
        $group: {
          _id: null,
          amount: { $sum: "$commissionAmount" },
          count: { $sum: 1 },
        },
      },
    ]),
    GameMatch.aggregate([
      {
        $match: {
          status: MATCH_STATUS.SETTLED,
          $or: [{ platformCommissionId: null }, { platformCommissionId: { $exists: false } }],
          ...(dateRange ? { settledAt: dateRange } : {}),
        },
      },
      {
        $group: {
          _id: null,
          amount: { $sum: "$platformFee" },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const totalsByType = new Map(
    financialTotals.map(item => [item._id, item.amount])
  );
  return {
    totalUsers,
    activeUsers,
    blockedUsers,
    totalGames,
    activeGames,
    totalMatches,
    completedMatches,
    pendingDeposits,
    pendingWithdrawals,
    openSupportTickets,
    totalDeposits: totalsByType.get(TRANSACTION_TYPE.ADD_MONEY) || 0,
    totalWithdrawals: totalsByType.get(TRANSACTION_TYPE.WITHDRAW) || 0,
    platformCommissionTotal: platformCommissionTotals[0]?.amount || 0,
    platformCommissionCount: platformCommissionTotals[0]?.count || 0,
    legacyPlatformFeeTotal: legacyPlatformFeeTotals[0]?.amount || 0,
    legacySettledMatchCount: legacyPlatformFeeTotals[0]?.count || 0,
    // Deprecated compatibility alias. New consumers should use the explicit
    // platformCommissionTotal field; it never includes legacy platform fees.
    platformEarnings: platformCommissionTotals[0]?.amount || 0,
  };
}

module.exports = { getSummary };
