const mongoose = require("mongoose");
const User = require("../models/User");
const Wallet = require("../models/Wallet");
const WalletTransaction = require("../models/WalletTransaction");
const { TRANSACTION_STATUS } = require("../constants/transactionStatus");
const { TRANSACTION_TYPE } = require("../constants/transactionTypes");
const { addMoney, roundMoney, subtractMoney } = require("../utils/money");
const dateUtils = require("../utils/date");

const WITHDRAWAL_STATUSES = [
  TRANSACTION_STATUS.INITIATED,
  TRANSACTION_STATUS.SUCCESS,
  TRANSACTION_STATUS.FAILED,
];

function createWithdrawalError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function validateObjectId(value, label) {
  if (!mongoose.isValidObjectId(value)) {
    throw createWithdrawalError(`Invalid ${label}`, 400);
  }
}

function validateAmount(amount) {
  const validString =
    typeof amount === "string" && /^\d+(?:\.\d{1,2})?$/.test(amount.trim());
  const numericAmount =
    typeof amount === "number"
      ? amount
      : validString
        ? Number(amount)
        : Number.NaN;

  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw createWithdrawalError("Amount must be greater than 0", 400);
  }

  try {
    const normalizedAmount = roundMoney(numericAmount);
    if (normalizedAmount <= 0) {
      throw createWithdrawalError("Amount must be at least 0.01", 400);
    }
    return normalizedAmount;
  } catch (error) {
    if (error.statusCode) throw error;
    throw createWithdrawalError("Amount is outside the supported range", 400);
  }
}

function validateUpiId(upiId) {
  if (
    typeof upiId !== "string" ||
    upiId.trim().length > 200 ||
    /\s/.test(upiId.trim()) ||
    !/^[^@]+@[^@]+$/.test(upiId.trim())
  ) {
    throw createWithdrawalError("A valid destination UPI ID is required", 400);
  }
  return upiId.trim();
}

function validateOptionalText(value, label, maxLength) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.trim().length > maxLength) {
    throw createWithdrawalError(`${label} must be text of at most ${maxLength} characters`, 400);
  }
  return value.trim() || undefined;
}

function validateClientRequestId(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (
    typeof value !== "string" ||
    value.trim().length < 1 ||
    value.trim().length > 128
  ) {
    throw createWithdrawalError(
      "clientRequestId must be between 1 and 128 characters",
      400
    );
  }
  return value.trim();
}

function validatePagination(pageValue, limitValue) {
  const page = Number(pageValue ?? 1);
  const limit = Number(limitValue ?? 20);
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    throw createWithdrawalError("Page must be positive and limit must be 1-100", 400);
  }
  return { page, limit };
}

function validateStatus(status) {
  if (status && !WITHDRAWAL_STATUSES.includes(status)) {
    throw createWithdrawalError("Invalid withdrawal status", 400);
  }
}

function getDateFilters(query) {
  const fromDate = query.fromDate ?? query.from;
  const toDate = query.toDate ?? query.to;
  if (query.fromDate && query.from && query.fromDate !== query.from) {
    throw createWithdrawalError("Provide only one from date", 400);
  }
  if (query.toDate && query.to && query.toDate !== query.to) {
    throw createWithdrawalError("Provide only one to date", 400);
  }
  return dateUtils.getISTDateRange(fromDate, toDate);
}

function formatWithdrawal(transaction, user = null) {
  const userId = transaction.userId?._id
    ? transaction.userId._id.toString()
    : transaction.userId?.toString() || null;
  return {
    transactionId: transaction._id.toString(),
    userId,
    userName: user?.fullName,
    phone: transaction.phone || user?.phone,
    amount: transaction.amount,
    upiId: transaction.upiId,
    upiApp: transaction.upiApp || null,
    upiTransactionId: transaction.upiTransactionId || null,
    status: transaction.status,
    balanceBefore: transaction.balanceBefore,
    balanceAfter: transaction.balanceAfter,
    remarks: transaction.remarks || null,
    processedBy: transaction.processedBy?._id
      ? {
          id: transaction.processedBy._id.toString(),
          name: transaction.processedBy.fullName,
          phone: transaction.processedBy.phone,
        }
      : transaction.processedBy?.toString() || null,
    processedAt: transaction.processedAt || null,
    createdAt: transaction.createdAt,
    updatedAt: transaction.updatedAt,
  };
}

function isSameRequest(transaction, { amount, upiId, upiApp }) {
  return (
    transaction.amount === amount &&
    transaction.upiId === upiId &&
    (transaction.upiApp || undefined) === upiApp
  );
}

function formatCreateResponse(transaction) {
  return {
    transactionId: transaction._id.toString(),
    amount: transaction.amount,
    upiId: transaction.upiId,
    status: transaction.status,
    balanceAfter: transaction.balanceAfter,
  };
}

async function findExistingRequest(userId, clientRequestId) {
  if (!clientRequestId) return null;
  return WalletTransaction.findOne({
    userId,
    transactionType: TRANSACTION_TYPE.WITHDRAW,
    clientRequestId,
  });
}

async function createWithdrawal(userId, requestData) {
  validateObjectId(userId, "user");
  if (!requestData || typeof requestData !== "object" || Array.isArray(requestData)) {
    throw createWithdrawalError("Withdrawal details are required", 400);
  }

  const allowedFields = ["amount", "upiId", "upiApp", "clientRequestId"];
  if (Object.keys(requestData).some(field => !allowedFields.includes(field))) {
    throw createWithdrawalError("Withdrawal request contains unsupported fields", 400);
  }
  const amount = validateAmount(requestData.amount);
  const upiId = validateUpiId(requestData.upiId);
  const upiApp = validateOptionalText(requestData.upiApp, "UPI app", 100);
  const clientRequestId = validateClientRequestId(requestData.clientRequestId);
  const requestDetails = { amount, upiId, upiApp };

  const priorRequest = await findExistingRequest(userId, clientRequestId);
  if (priorRequest) {
    if (!isSameRequest(priorRequest, requestDetails)) {
      throw createWithdrawalError(
        "clientRequestId was already used for a different withdrawal",
        409
      );
    }
    return formatCreateResponse(priorRequest);
  }

  const user = await User.findById(userId).select("_id phone");
  if (!user) throw createWithdrawalError("User not found", 404);

  const session = await mongoose.startSession();
  let withdrawal;

  try {
    await session.withTransaction(async () => {
      const retriedRequest = clientRequestId
        ? await WalletTransaction.findOne({
            userId,
            transactionType: TRANSACTION_TYPE.WITHDRAW,
            clientRequestId,
          }).session(session)
        : null;
      if (retriedRequest) {
        if (!isSameRequest(retriedRequest, requestDetails)) {
          throw createWithdrawalError(
            "clientRequestId was already used for a different withdrawal",
            409
          );
        }
        withdrawal = retriedRequest;
        return;
      }

      const wallet = await Wallet.findOne({ userId }).session(session);
      if (!wallet) throw createWithdrawalError("Wallet not found", 404);

      const balanceBefore = roundMoney(wallet.balance);
      let balanceAfter;
      try {
        balanceAfter = subtractMoney(balanceBefore, amount);
      } catch (error) {
        throw createWithdrawalError("Wallet balance is outside the supported range", 400);
      }
      if (balanceAfter < 0) {
        throw createWithdrawalError("Insufficient wallet balance", 400);
      }

      const updatedWallet = await Wallet.findOneAndUpdate(
        {
          _id: wallet._id,
          userId,
          balance: { $eq: wallet.balance, $gte: amount },
        },
        { $set: { balance: balanceAfter } },
        { new: true, runValidators: true, session }
      );
      if (!updatedWallet) {
        throw createWithdrawalError("Insufficient wallet balance", 400);
      }

      const [createdWithdrawal] = await WalletTransaction.create(
        [
          {
            walletId: wallet._id,
            userId,
            phone: user.phone,
            transactionType: TRANSACTION_TYPE.WITHDRAW,
            amount,
            balanceBefore,
            balanceAfter,
            status: TRANSACTION_STATUS.INITIATED,
            upiId,
            upiApp,
            clientRequestId,
            remarks: "Withdrawal initiated",
          },
        ],
        { session }
      );
      withdrawal = createdWithdrawal;
    });
  } catch (error) {
    if (error.code === 11000 && clientRequestId) {
      const duplicateRequest = await findExistingRequest(userId, clientRequestId);
      if (duplicateRequest && isSameRequest(duplicateRequest, requestDetails)) {
        return formatCreateResponse(duplicateRequest);
      }
      if (duplicateRequest) {
        throw createWithdrawalError(
          "clientRequestId was already used for a different withdrawal",
          409
        );
      }
    }
    throw error;
  } finally {
    await session.endSession();
  }

  return formatCreateResponse(withdrawal);
}

async function getUserWithdrawals(userId, query) {
  validateObjectId(userId, "user");
  const { page, limit } = validatePagination(query.page, query.limit);
  validateStatus(query.status);
  const filter = {
    userId,
    transactionType: TRANSACTION_TYPE.WITHDRAW,
  };
  if (query.status) filter.status = query.status;
  const dateRange = getDateFilters(query);
  if (dateRange) filter.createdAt = dateRange;

  const [transactions, total] = await Promise.all([
    WalletTransaction.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    WalletTransaction.countDocuments(filter),
  ]);
  return {
    withdrawals: transactions.map(transaction => formatWithdrawal(transaction)),
    pagination: {
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    },
  };
}

async function getPendingWithdrawals(query = {}) {
  const { page, limit } = validatePagination(query.page, query.limit);
  const filter = {
    transactionType: TRANSACTION_TYPE.WITHDRAW,
    status: TRANSACTION_STATUS.INITIATED,
  };
  const [transactions, total] = await Promise.all([
    WalletTransaction.find(filter)
      .sort({ createdAt: 1, _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("userId", "_id fullName phone")
      .lean(),
    WalletTransaction.countDocuments(filter),
  ]);
  return {
    withdrawals: transactions.map(transaction => {
      const withdrawal = formatWithdrawal(transaction, transaction.userId);
      return {
        transactionId: withdrawal.transactionId,
        userId: withdrawal.userId,
        userName: withdrawal.userName,
        phone: withdrawal.phone,
        amount: withdrawal.amount,
        upiId: withdrawal.upiId,
        upiApp: withdrawal.upiApp,
        status: withdrawal.status,
        createdAt: withdrawal.createdAt,
      };
    }),
    pagination: {
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    },
  };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function getAdminWithdrawals(query) {
  const { page, limit } = validatePagination(query.page, query.limit);
  validateStatus(query.status);
  const filter = { transactionType: TRANSACTION_TYPE.WITHDRAW };
  if (query.status) filter.status = query.status;

  if (query.userId) {
    validateObjectId(query.userId, "user ID");
    filter.userId = query.userId;
  }
  const dateRange = getDateFilters(query);
  if (dateRange) filter.createdAt = dateRange;

  if (query.search !== undefined) {
    if (typeof query.search !== "string" || query.search.trim().length > 100) {
      throw createWithdrawalError("Search must be 100 characters or fewer", 400);
    }
    const search = escapeRegex(query.search.trim());
    if (search) {
      const users = await User.find({
        $or: [
          { phone: { $regex: search, $options: "i" } },
          { fullName: { $regex: search, $options: "i" } },
        ],
      })
        .select("_id")
        .limit(101)
        .lean();
      const userIds = users.map(user => user._id);
      filter.$or = [
        ...(userIds.length ? [{ userId: { $in: userIds } }] : []),
        { upiId: { $regex: search, $options: "i" } },
        { upiTransactionId: { $regex: search, $options: "i" } },
      ];
    }
  }

  const [transactions, total] = await Promise.all([
    WalletTransaction.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("userId", "_id fullName phone")
      .lean(),
    WalletTransaction.countDocuments(filter),
  ]);

  return {
    withdrawals: transactions.map(transaction =>
      formatWithdrawal(
        transaction,
        transaction.userId && typeof transaction.userId === "object"
          ? transaction.userId
          : null
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

async function getWithdrawalById(transactionId) {
  validateObjectId(transactionId, "transaction ID");
  const transaction = await WalletTransaction.findOne({
    _id: transactionId,
    transactionType: TRANSACTION_TYPE.WITHDRAW,
  })
    .populate("userId", "_id fullName phone")
    .populate("processedBy", "_id fullName phone")
    .lean();
  if (!transaction) throw createWithdrawalError("Withdrawal not found", 404);

  const user = transaction.userId;
  return {
    ...formatWithdrawal(transaction, user),
    user: user
      ? {
          id: user._id.toString(),
          name: user.fullName,
          phone: user.phone,
        }
      : null,
  };
}

async function markWithdrawalSuccess(transactionId, adminId, data) {
  validateObjectId(transactionId, "transaction ID");
  validateObjectId(adminId, "admin");
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw createWithdrawalError("Payout details are required", 400);
  }
  if (Object.keys(data).some(field => !["upiTransactionId", "remarks"].includes(field))) {
    throw createWithdrawalError("Payout request contains unsupported fields", 400);
  }
  const upiTransactionId = validateOptionalText(
    data.upiTransactionId,
    "UPI transaction ID",
    200
  );
  if (!upiTransactionId) {
    throw createWithdrawalError("UPI transaction ID is required", 400);
  }
  const remarks = validateOptionalText(data.remarks, "Remarks", 500);
  const transaction = await WalletTransaction.findOneAndUpdate(
    {
      _id: transactionId,
      transactionType: TRANSACTION_TYPE.WITHDRAW,
      status: TRANSACTION_STATUS.INITIATED,
    },
    {
      $set: {
        status: TRANSACTION_STATUS.SUCCESS,
        upiTransactionId,
        processedBy: adminId,
        processedAt: new Date(),
        remarks: remarks || "Payout completed",
      },
    },
    { new: true, runValidators: true }
  );

  if (transaction) {
    return {
      transactionId: transaction._id.toString(),
      userId: transaction.userId.toString(),
      amount: transaction.amount,
      status: transaction.status,
    };
  }
  const existing = await WalletTransaction.findOne({
    _id: transactionId,
    transactionType: TRANSACTION_TYPE.WITHDRAW,
  }).select("_id");
  if (!existing) throw createWithdrawalError("Withdrawal not found", 404);
  throw createWithdrawalError("Withdrawal has already been processed", 409);
}

async function rejectWithdrawal(transactionId, adminId, reason) {
  validateObjectId(transactionId, "transaction ID");
  validateObjectId(adminId, "admin");
  if (
    typeof reason !== "string" ||
    reason.trim().length < 5 ||
    reason.trim().length > 500
  ) {
    throw createWithdrawalError(
      "Rejection reason must be between 5 and 500 characters",
      400
    );
  }

  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const withdrawal = await WalletTransaction.findOne({
        _id: transactionId,
        transactionType: TRANSACTION_TYPE.WITHDRAW,
      }).session(session);
      if (!withdrawal) {
        throw createWithdrawalError("Withdrawal not found", 404);
      }
      if (withdrawal.status !== TRANSACTION_STATUS.INITIATED) {
        throw createWithdrawalError(
          "Withdrawal has already been processed",
          409
        );
      }

      const wallet = await Wallet.findOne({
        _id: withdrawal.walletId,
        userId: withdrawal.userId,
      }).session(session);
      if (!wallet) throw createWithdrawalError("Wallet not found", 404);

      const balanceBefore = roundMoney(wallet.balance);
      let balanceAfter;
      try {
        balanceAfter = addMoney(balanceBefore, withdrawal.amount);
      } catch (error) {
        throw createWithdrawalError(
          "Wallet balance is outside the supported range",
          400
        );
      }

      const updatedWallet = await Wallet.findOneAndUpdate(
        {
          _id: wallet._id,
          userId: withdrawal.userId,
          balance: wallet.balance,
        },
        { $set: { balance: balanceAfter } },
        { new: true, runValidators: true, session }
      );
      if (!updatedWallet) {
        throw createWithdrawalError(
          "Wallet changed during refund; retry the request",
          409
        );
      }

      const processedAt = new Date();
      const updatedWithdrawal = await WalletTransaction.findOneAndUpdate(
        {
          _id: withdrawal._id,
          transactionType: TRANSACTION_TYPE.WITHDRAW,
          status: TRANSACTION_STATUS.INITIATED,
        },
        {
          $set: {
            status: TRANSACTION_STATUS.FAILED,
            processedBy: adminId,
            processedAt,
            remarks: reason.trim(),
          },
        },
        { new: true, runValidators: true, session }
      );
      if (!updatedWithdrawal) {
        throw createWithdrawalError(
          "Withdrawal has already been processed",
          409
        );
      }

      await WalletTransaction.create(
        [
          {
            walletId: wallet._id,
            userId: withdrawal.userId,
            phone: withdrawal.phone,
            transactionType: TRANSACTION_TYPE.WITHDRAW_REFUND,
            amount: withdrawal.amount,
            balanceBefore,
            balanceAfter,
            status: TRANSACTION_STATUS.SUCCESS,
            processedBy: adminId,
            processedAt,
            remarks: `Refund for rejected withdrawal: ${reason.trim()}`,
            referenceType: "WITHDRAWAL",
            referenceId: withdrawal._id.toString(),
          },
        ],
        { session }
      );

      result = {
        transactionId: updatedWithdrawal._id.toString(),
        userId: updatedWithdrawal.userId.toString(),
        amount: updatedWithdrawal.amount,
        status: updatedWithdrawal.status,
      };
    });
    return result;
  } finally {
    await session.endSession();
  }
}

module.exports = {
  createWithdrawal,
  markWithdrawalSuccess,
  rejectWithdrawal,
  getUserWithdrawals,
  getPendingWithdrawals,
  getAdminWithdrawals,
  getWithdrawalById,
};
