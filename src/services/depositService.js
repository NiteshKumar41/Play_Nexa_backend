const mongoose = require("mongoose");
const PaymentMethod = require("../models/PaymentMethod");
const User = require("../models/User");
const Wallet = require("../models/Wallet");
const WalletTransaction = require("../models/WalletTransaction");
const { TRANSACTION_STATUS } = require("../constants/transactionStatus");
const { TRANSACTION_TYPE } = require("../constants/transactionTypes");
const { addMoney, roundMoney } = require("../utils/money");
const dateUtils = require("../utils/date");
const fileStorage = require("../utils/fileStorage");

const DEPOSIT_STATUSES = [
  TRANSACTION_STATUS.PENDING,
  TRANSACTION_STATUS.SUCCESS,
  TRANSACTION_STATUS.FAILED,
];

function createDepositError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function validateObjectId(value, label) {
  if (!mongoose.isValidObjectId(value)) {
    throw createDepositError(`Invalid ${label}`, 400);
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
    throw createDepositError("Amount must be greater than 0", 400);
  }

  try {
    const normalizedAmount = roundMoney(numericAmount);
    if (normalizedAmount <= 0) {
      throw createDepositError("Amount must be at least 0.01", 400);
    }
    return normalizedAmount;
  } catch (error) {
    if (error.statusCode) throw error;
    throw createDepositError("Amount is outside the supported range", 400);
  }
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
    throw createDepositError("Page must be positive and limit must be 1-100", 400);
  }
  return { page, limit };
}

function validateStatus(status) {
  if (status && !DEPOSIT_STATUSES.includes(status)) {
    throw createDepositError("Invalid deposit status", 400);
  }
}

function validateOptionalText(value, fieldName, maxLength) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.trim().length > maxLength) {
    throw createDepositError(`${fieldName} must be text of at most ${maxLength} characters`, 400);
  }
  return value.trim() || undefined;
}

function getDateFilters(query) {
  const fromDate = query.fromDate ?? query.from;
  const toDate = query.toDate ?? query.to;
  if (query.fromDate && query.from && query.fromDate !== query.from) {
    throw createDepositError("Provide only one from date", 400);
  }
  if (query.toDate && query.to && query.toDate !== query.to) {
    throw createDepositError("Provide only one to date", 400);
  }
  return dateUtils.getISTDateRange(fromDate, toDate);
}

function formatDeposit(transaction, user = null) {
  const userId = transaction.userId?._id
    ? transaction.userId._id.toString()
    : transaction.userId?.toString() || null;
  return {
    transactionId: transaction._id.toString(),
    userId,
    userName: user?.fullName,
    phone: transaction.phone || user?.phone,
    amount: transaction.amount,
    upiApp: transaction.upiApp || null,
    upiTransactionId: transaction.upiTransactionId || null,
    proofUrl: transaction.proofUrl,
    status: transaction.status,
    balanceBefore: transaction.balanceBefore,
    balanceAfter: transaction.balanceAfter,
    remarks: transaction.remarks || null,
    processedBy: transaction.processedBy?.toString() || null,
    processedAt: transaction.processedAt || null,
    createdAt: transaction.createdAt,
    updatedAt: transaction.updatedAt,
  };
}

async function createDeposit(userId, depositData, proofFile) {
  validateObjectId(userId, "user");
  if (!proofFile) throw createDepositError("Payment proof is required", 400);

  const amount = validateAmount(depositData?.amount);
  const upiApp = validateOptionalText(depositData?.upiApp, "UPI app", 100);
  const upiTransactionId = validateOptionalText(
    depositData?.upiTransactionId,
    "UPI transaction ID",
    200
  );

  const paymentMethod = await PaymentMethod.findOne({ status: true }).select(
    "_id upiId"
  );
  if (!paymentMethod) {
    throw createDepositError("No active payment method is available", 404);
  }

  const [user, wallet] = await Promise.all([
    User.findById(userId).select("_id phone"),
    Wallet.findOne({ userId }).select("_id balance userId"),
  ]);
  if (!user || !wallet || wallet.userId.toString() !== userId.toString()) {
    throw createDepositError("Wallet not found", 404);
  }

  let proofFileName;
  try {
    proofFileName = await fileStorage.saveDepositProof(proofFile);
    const transactionId = new mongoose.Types.ObjectId();
    const [transaction] = await WalletTransaction.create([
      {
        _id: transactionId,
        userId,
        walletId: wallet._id,
        phone: user.phone,
        transactionType: TRANSACTION_TYPE.ADD_MONEY,
        amount,
        balanceBefore: roundMoney(wallet.balance),
        balanceAfter: roundMoney(wallet.balance),
        status: TRANSACTION_STATUS.PENDING,
        upiId: paymentMethod.upiId,
        upiApp,
        upiTransactionId,
        proofUrl: fileStorage.getDepositProofUrl(
          transactionId,
          proofFileName
        ),
        remarks: "Deposit request submitted",
      },
    ]);

    return formatDeposit(transaction);
  } catch (error) {
    if (proofFileName) await fileStorage.deleteDepositProof(proofFileName);
    if (error.code === 11000) {
      throw createDepositError("Payment transaction already submitted", 409);
    }
    throw error;
  }
}

async function getUserDeposits(userId, query) {
  validateObjectId(userId, "user");
  const { page, limit } = validatePagination(query.page, query.limit);
  validateStatus(query.status);
  const filter = {
    userId,
    transactionType: TRANSACTION_TYPE.ADD_MONEY,
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
    deposits: transactions.map(transaction => formatDeposit(transaction)),
    pagination: {
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    },
  };
}

async function getPendingDeposits(query = {}) {
  const { page, limit } = validatePagination(query.page, query.limit);
  const filter = {
    transactionType: TRANSACTION_TYPE.ADD_MONEY,
    status: TRANSACTION_STATUS.PENDING,
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
    deposits: transactions.map(transaction =>
      formatDeposit(transaction, transaction.userId)
    ),
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

async function getAdminDeposits(query) {
  const { page, limit } = validatePagination(query.page, query.limit);
  validateStatus(query.status);
  const filter = { transactionType: TRANSACTION_TYPE.ADD_MONEY };
  if (query.status) filter.status = query.status;

  if (query.userId) {
    validateObjectId(query.userId, "user ID");
    filter.userId = query.userId;
  }

  const dateRange = getDateFilters(query);
  if (dateRange) filter.createdAt = dateRange;

  if (query.search !== undefined) {
    if (typeof query.search !== "string" || query.search.trim().length > 100) {
      throw createDepositError("Search must be 100 characters or fewer", 400);
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
    deposits: transactions.map(transaction =>
      formatDeposit(
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

async function getDepositDetail(transactionId) {
  validateObjectId(transactionId, "transaction ID");
  const transaction = await WalletTransaction.findOne({
    _id: transactionId,
    transactionType: TRANSACTION_TYPE.ADD_MONEY,
  })
    .populate("userId", "_id fullName phone")
    .populate("processedBy", "_id fullName phone")
    .lean();

  if (!transaction) throw createDepositError("Deposit not found", 404);
  const user = transaction.userId;
  return {
    ...formatDeposit(transaction, user),
    user: user
      ? {
          id: user._id.toString(),
          name: user.fullName,
          phone: user.phone,
        }
      : null,
    processedBy: transaction.processedBy
      ? {
          id: transaction.processedBy._id.toString(),
          name: transaction.processedBy.fullName,
          phone: transaction.processedBy.phone,
        }
      : null,
  };
}

async function approveDeposit(transactionId, adminId) {
  validateObjectId(transactionId, "transaction ID");
  validateObjectId(adminId, "admin");
  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      const deposit = await WalletTransaction.findOne({
        _id: transactionId,
        transactionType: TRANSACTION_TYPE.ADD_MONEY,
      }).session(session);
      if (!deposit) throw createDepositError("Deposit not found", 404);
      if (deposit.status !== TRANSACTION_STATUS.PENDING) {
        throw createDepositError("Deposit has already been processed", 409);
      }

      const wallet = await Wallet.findOne({
        _id: deposit.walletId,
        userId: deposit.userId,
      }).session(session);
      if (!wallet) throw createDepositError("Wallet not found", 404);

      const balanceBefore = roundMoney(wallet.balance);
      let balanceAfter;
      try {
        balanceAfter = addMoney(balanceBefore, deposit.amount);
      } catch (error) {
        throw createDepositError("Wallet balance is outside the supported range", 400);
      }

      const updatedWallet = await Wallet.findOneAndUpdate(
        { _id: wallet._id, balance: wallet.balance },
        { $set: { balance: balanceAfter } },
        { new: true, runValidators: true, session }
      );
      if (!updatedWallet) {
        throw createDepositError("Wallet changed during approval; retry the request", 409);
      }

      const now = new Date();
      const updatedDeposit = await WalletTransaction.findOneAndUpdate(
        {
          _id: deposit._id,
          transactionType: TRANSACTION_TYPE.ADD_MONEY,
          status: TRANSACTION_STATUS.PENDING,
        },
        {
          $set: {
            status: TRANSACTION_STATUS.SUCCESS,
            balanceBefore,
            balanceAfter,
            processedBy: adminId,
            processedAt: now,
            remarks: "Deposit approved",
          },
        },
        { new: true, runValidators: true, session }
      );
      if (!updatedDeposit) {
        throw createDepositError("Deposit has already been processed", 409);
      }

      result = {
        transactionId: updatedDeposit._id.toString(),
        userId: updatedDeposit.userId.toString(),
        amount: updatedDeposit.amount,
        status: updatedDeposit.status,
      };
    });
    return result;
  } finally {
    await session.endSession();
  }
}

async function rejectDeposit(transactionId, adminId, reason) {
  validateObjectId(transactionId, "transaction ID");
  validateObjectId(adminId, "admin");
  if (typeof reason !== "string" || reason.trim().length < 5 || reason.trim().length > 500) {
    throw createDepositError("Rejection reason must be between 5 and 500 characters", 400);
  }

  const updatedDeposit = await WalletTransaction.findOneAndUpdate(
    {
      _id: transactionId,
      transactionType: TRANSACTION_TYPE.ADD_MONEY,
      status: TRANSACTION_STATUS.PENDING,
    },
    {
      $set: {
        status: TRANSACTION_STATUS.FAILED,
        processedBy: adminId,
        processedAt: new Date(),
        remarks: reason.trim(),
      },
    },
    { new: true, runValidators: true }
  );
  if (updatedDeposit) {
    return {
      transactionId: updatedDeposit._id.toString(),
      userId: updatedDeposit.userId.toString(),
      amount: updatedDeposit.amount,
      status: updatedDeposit.status,
    };
  }

  const deposit = await WalletTransaction.findOne({
    _id: transactionId,
    transactionType: TRANSACTION_TYPE.ADD_MONEY,
  }).select("status");
  if (!deposit) throw createDepositError("Deposit not found", 404);
  throw createDepositError("Deposit has already been processed", 409);
}

async function getDepositProof(transactionId, fileName, userId, role) {
  validateObjectId(transactionId, "transaction ID");
  validateObjectId(userId, "user");
  const deposit = await WalletTransaction.findOne({
    _id: transactionId,
    transactionType: TRANSACTION_TYPE.ADD_MONEY,
  }).select("userId proofUrl");

  if (!deposit) throw createDepositError("Deposit not found", 404);
  if (role !== "admin" && deposit.userId.toString() !== userId.toString()) {
    throw createDepositError("You are not allowed to access this proof", 403);
  }
  if (
    deposit.proofUrl !==
    fileStorage.getDepositProofUrl(transactionId, fileName)
  ) {
    throw createDepositError("Payment proof not found", 404);
  }

  return {
    buffer: await fileStorage.readDepositProof(fileName),
    contentType: fileStorage.getFileContentType(fileName),
  };
}

module.exports = {
  createDeposit,
  getUserDeposits,
  getPendingDeposits,
  getAdminDeposits,
  getDepositDetail,
  approveDeposit,
  rejectDeposit,
  getDepositProof,
};
