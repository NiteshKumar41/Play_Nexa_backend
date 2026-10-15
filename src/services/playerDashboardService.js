const mongoose = require("mongoose");
const User = require("../models/User");
const Wallet = require("../models/Wallet");
const WalletTransaction = require("../models/WalletTransaction");
const GameMatch = require("../models/GameMatch");
const { TRANSACTION_TYPE } = require("../constants/transactionTypes");
const { TRANSACTION_STATUS } = require("../constants/transactionStatus");
const { MATCH_STATUS } = require("../constants/matchStatus");
const { roundMoney } = require("../utils/money");
const userService = require("./userService");

const RECENT_TRANSACTION_LIMIT = 5;
const RECENT_MATCH_LIMIT = 5;
const RECENT_ACTIVITY_LIMIT = 8;
const PLAYED_MATCH_STATUSES = [
  MATCH_STATUS.JOINED,
  MATCH_STATUS.COMPLETED,
  MATCH_STATUS.DISPUTED,
  MATCH_STATUS.SETTLED,
];
const ACTIVE_MATCH_STATUSES = [MATCH_STATUS.ACTIVE, MATCH_STATUS.JOINED];
const SETTLEMENT_STATUSES = [MATCH_STATUS.COMPLETED, MATCH_STATUS.DISPUTED];

function createDashboardError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function validateUserId(userId) {
  if (!mongoose.isValidObjectId(userId)) {
    throw createDashboardError("Invalid user ID", 400);
  }
}

function money(value) {
  return roundMoney(Number(value || 0));
}

function calculateWinRate(wins, totalPlayed) {
  if (!totalPlayed) return 0;
  return Math.round((wins / totalPlayed) * 1000) / 10;
}

function formatTransaction(transaction) {
  return {
    id: transaction._id.toString(),
    transactionType: transaction.transactionType,
    amount: money(transaction.amount),
    status: transaction.status,
    referenceId: transaction.referenceId || null,
    referenceType: transaction.referenceType || null,
    remarks: transaction.remarks || null,
    createdAt: transaction.createdAt,
  };
}

function getMatchEntryAmount(match, userId) {
  return String(match.player1) === userId
    ? money(match.player1Amount)
    : money(match.player2Amount);
}

function formatMatch(match, userId) {
  const isPlayerOne = String(match.player1) === userId;
  const opponentName = isPlayerOne ? match.player2Name : match.player1Name;
  const game = match.gameId && typeof match.gameId === "object"
    ? {
        id: match.gameId._id.toString(),
        name: match.gameId.name,
        gameCode: match.gameId.gameCode,
      }
    : null;

  return {
    id: match._id.toString(),
    game,
    opponentName: opponentName || null,
    status: match.status,
    entryAmount: getMatchEntryAmount(match, userId),
    prizePool: money(match.prizePool),
    grossWinningAmount: money(match.grossWinningAmount),
    winnerNetPayout: money(match.winnerNetPayout),
    referralReward: money(match.referralReward),
    winnerPlayer: match.winnerPlayer ? match.winnerPlayer.toString() : null,
    createdAt: match.createdAt,
    updatedAt: match.updatedAt,
    settledAt: match.settledAt || null,
  };
}

function mergeRecentActivity(transactions, matches) {
  const transactionActivity = transactions.map(transaction => ({
    activityId: `transaction-${transaction.id}`,
    kind: "TRANSACTION",
    createdAt: transaction.createdAt,
    transaction,
  }));
  const matchActivity = matches.map(match => ({
    activityId: `match-${match.id}`,
    kind: "MATCH",
    createdAt: match.updatedAt || match.createdAt,
    match,
  }));

  return [...transactionActivity, ...matchActivity]
    .sort((first, second) => {
      const secondTime = new Date(second.createdAt).getTime();
      const firstTime = new Date(first.createdAt).getTime();
      return secondTime - firstTime;
    })
    .slice(0, RECENT_ACTIVITY_LIMIT);
}

async function getPlayerSummary(userId) {
  validateUserId(userId);
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const participantFilter = {
    $or: [{ player1: userObjectId }, { player2: userObjectId }],
  };

  const [
    profile,
    wallet,
    transactionTotals,
    matchTotals,
    grossWinnings,
    recentTransactions,
    recentMatches,
    activeRecentMatches,
    referralCount,
  ] = await Promise.all([
    userService.getOwnProfile(userId),
    Wallet.findOne({ userId: userObjectId }).select("balance").lean(),
    WalletTransaction.aggregate([
      { $match: { userId: userObjectId } },
      {
        $group: {
          _id: null,
          pendingDeposits: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$transactionType", TRANSACTION_TYPE.ADD_MONEY] },
                    { $eq: ["$status", TRANSACTION_STATUS.PENDING] },
                  ],
                },
                "$amount",
                0,
              ],
            },
          },
          pendingWithdrawals: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$transactionType", TRANSACTION_TYPE.WITHDRAW] },
                    { $eq: ["$status", TRANSACTION_STATUS.INITIATED] },
                  ],
                },
                "$amount",
                0,
              ],
            },
          },
          totalDeposits: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$transactionType", TRANSACTION_TYPE.ADD_MONEY] },
                    { $eq: ["$status", TRANSACTION_STATUS.SUCCESS] },
                  ],
                },
                "$amount",
                0,
              ],
            },
          },
          totalWithdrawals: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$transactionType", TRANSACTION_TYPE.WITHDRAW] },
                    { $eq: ["$status", TRANSACTION_STATUS.SUCCESS] },
                  ],
                },
                "$amount",
                0,
              ],
            },
          },
          entryFeesPaid: {
            $sum: {
              $cond: [
                {
                  $and: [
                    {
                      $in: [
                        "$transactionType",
                        [TRANSACTION_TYPE.GAME_CREATE, TRANSACTION_TYPE.GAME_JOIN],
                      ],
                    },
                    { $eq: ["$status", TRANSACTION_STATUS.SUCCESS] },
                  ],
                },
                "$amount",
                0,
              ],
            },
          },
          netWinnings: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$transactionType", TRANSACTION_TYPE.GAME_WIN] },
                    { $eq: ["$status", TRANSACTION_STATUS.SUCCESS] },
                  ],
                },
                "$amount",
                0,
              ],
            },
          },
          referralRewards: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$transactionType", TRANSACTION_TYPE.REFERRAL_REWARD] },
                    { $eq: ["$status", TRANSACTION_STATUS.SUCCESS] },
                  ],
                },
                "$amount",
                0,
              ],
            },
          },
          referralRewardCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$transactionType", TRANSACTION_TYPE.REFERRAL_REWARD] },
                    { $eq: ["$status", TRANSACTION_STATUS.SUCCESS] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]),
    GameMatch.aggregate([
      { $match: participantFilter },
      {
        $group: {
          _id: null,
          totalPlayed: {
            $sum: { $cond: [{ $in: ["$status", PLAYED_MATCH_STATUSES] }, 1, 0] },
          },
          wins: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$status", MATCH_STATUS.SETTLED] },
                    { $eq: ["$winnerPlayer", userObjectId] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          losses: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$status", MATCH_STATUS.SETTLED] },
                    { $ne: ["$winnerPlayer", null] },
                    { $ne: ["$winnerPlayer", userObjectId] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          active: {
            $sum: { $cond: [{ $in: ["$status", ACTIVE_MATCH_STATUSES] }, 1, 0] },
          },
          pendingSettlement: {
            $sum: { $cond: [{ $in: ["$status", SETTLEMENT_STATUSES] }, 1, 0] },
          },
        },
      },
    ]),
    GameMatch.aggregate([
      {
        $match: {
          ...participantFilter,
          status: MATCH_STATUS.SETTLED,
          winnerPlayer: userObjectId,
        },
      },
      { $group: { _id: null, amount: { $sum: "$grossWinningAmount" } } },
    ]),
    WalletTransaction.find({ userId: userObjectId })
      .sort({ createdAt: -1, _id: -1 })
      .limit(RECENT_TRANSACTION_LIMIT)
      .select("_id transactionType amount status referenceId referenceType remarks createdAt")
      .lean(),
    GameMatch.find(participantFilter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(RECENT_MATCH_LIMIT)
      .select("_id gameId player1 player1Name player1Amount player2 player2Name player2Amount status prizePool grossWinningAmount winnerNetPayout referralReward winnerPlayer createdAt updatedAt settledAt")
      .populate({ path: "gameId", select: "_id name gameCode" })
      .lean(),
    GameMatch.find({
      ...participantFilter,
      status: { $in: ACTIVE_MATCH_STATUSES },
    })
      .sort({ createdAt: -1, _id: -1 })
      .limit(RECENT_MATCH_LIMIT)
      .select("_id gameId player1 player1Name player1Amount player2 player2Name player2Amount status prizePool grossWinningAmount winnerNetPayout referralReward winnerPlayer createdAt updatedAt settledAt")
      .populate({ path: "gameId", select: "_id name gameCode" })
      .lean(),
    User.countDocuments({ referredBy: userObjectId }),
  ]);

  const totals = transactionTotals[0] || {};
  const matches = matchTotals[0] || {};
  const formattedTransactions = recentTransactions.map(formatTransaction);
  const formattedMatches = recentMatches.map(match => formatMatch(match, userId));
  const formattedActiveMatches = activeRecentMatches.map(match => formatMatch(match, userId));

  return {
    profile,
    wallet: {
      availableBalance: money(wallet?.balance),
      walletAvailable: Boolean(wallet),
      pendingDeposits: money(totals.pendingDeposits),
      pendingWithdrawals: money(totals.pendingWithdrawals),
      totalDeposits: money(totals.totalDeposits),
      totalWithdrawals: money(totals.totalWithdrawals),
      recentTransactions: formattedTransactions,
    },
    matches: {
      totalPlayed: Number(matches.totalPlayed || 0),
      wins: Number(matches.wins || 0),
      losses: Number(matches.losses || 0),
      active: Number(matches.active || 0),
      pendingSettlement: Number(matches.pendingSettlement || 0),
      winRate: calculateWinRate(
        Number(matches.wins || 0),
        Number(matches.totalPlayed || 0)
      ),
      grossWinnings: money(grossWinnings[0]?.amount),
      netWinnings: money(totals.netWinnings),
      entryFeesPaid: money(totals.entryFeesPaid),
      recent: formattedMatches,
      activeRecent: formattedActiveMatches,
    },
    referrals: {
      code: profile.referralCode,
      hasReferrer: profile.hasReferrer,
      referredUsers: referralCount,
      rewardsCredited: money(totals.referralRewards),
      rewardCount: Number(totals.referralRewardCount || 0),
    },
    recentActivity: mergeRecentActivity(formattedTransactions, formattedMatches),
  };
}

module.exports = {
  getPlayerSummary,
  calculateWinRate,
  mergeRecentActivity,
};
