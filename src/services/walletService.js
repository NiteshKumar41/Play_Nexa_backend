const mongoose = require("mongoose");
const Wallet = require("../models/Wallet");
const WalletTransaction = require("../models/WalletTransaction");
const { TRANSACTION_STATUS } = require("../constants/transactionStatus");
const { TRANSACTION_TYPE } = require("../constants/transactionTypes");
const { roundMoney, addMoney, subtractMoney } = require("../utils/money");

function createWalletError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function validateAmount(amount) {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    throw createWalletError("Amount must be a number greater than 0", 400);
  }

  if (roundMoney(amount) <= 0) {
    throw createWalletError("Amount must be at least 0.01", 400);
  }
}

function validateUserId(userId) {
  if (!mongoose.isValidObjectId(userId)) {
    throw createWalletError("Invalid user", 400);
  }
}

function formatWallet(wallet) {
  return {
    id: wallet._id.toString(),
    userId: wallet.userId.toString(),
    balance: wallet.balance,
    createdAt: wallet.createdAt,
    updatedAt: wallet.updatedAt,
  };
}

function formatTransaction(transaction) {
  return {
    id: transaction._id.toString(),
    walletId: transaction.walletId.toString(),
    userId: transaction.userId.toString(),
    phone: transaction.phone,
    transactionType: transaction.transactionType,
    amount: transaction.amount,
    balanceBefore: transaction.balanceBefore,
    balanceAfter: transaction.balanceAfter,
    status: transaction.status,
    remarks: transaction.remarks,
    referenceId: transaction.referenceId,
    referenceType: transaction.referenceType,
    createdAt: transaction.createdAt,
    updatedAt: transaction.updatedAt,
  };
}

function validateTransactionType(transactionType) {
  if (!Object.values(TRANSACTION_TYPE).includes(transactionType)) {
    throw createWalletError("Invalid transaction type", 400);
  }
}

async function getWallet(userId) {
  validateUserId(userId);

  const wallet = await Wallet.findOne({ userId });

  if (!wallet) {
    throw createWalletError("Wallet not found", 404);
  }

  return formatWallet(wallet);
}

async function createWallet(userId, session) {
  validateUserId(userId);

  try {
    const [wallet] = await Wallet.create(
      [{ userId, balance: 0 }],
      session ? { session } : undefined
    );

    return formatWallet(wallet);
  } catch (error) {
    if (error.code === 11000) {
      throw createWalletError("Wallet already exists", 409);
    }

    throw error;
  }
}

async function updateWalletBalance({
  userId,
  amount,
  transactionType,
  remarks,
  referenceId,
  referenceType,
  phone,
  isCredit,
  session: existingSession,
}) {
  validateUserId(userId);
  validateAmount(amount);
  validateTransactionType(transactionType);
  const normalizedAmount = roundMoney(amount);

  async function applyWalletChange(session) {
    const wallet = await Wallet.findOne({ userId }).session(session);

    if (!wallet) {
      throw createWalletError("Wallet not found", 404);
    }

    const balanceBefore = roundMoney(wallet.balance);
    const newBalance = isCredit
      ? addMoney(balanceBefore, normalizedAmount)
      : subtractMoney(balanceBefore, normalizedAmount);

    if (!isCredit && newBalance < 0) {
      throw createWalletError("Insufficient wallet balance", 422);
    }

    const balanceCondition = isCredit
      ? {}
      : { balance: { $gte: normalizedAmount } };
    const updatedWallet = await Wallet.findOneAndUpdate(
      { _id: wallet._id, ...balanceCondition },
      { $set: { balance: newBalance } },
      { new: true, runValidators: true, session }
    );

    if (!updatedWallet) {
      throw createWalletError("Insufficient wallet balance", 422);
    }

    const [transaction] = await WalletTransaction.create(
      [
        {
          walletId: wallet._id,
          userId,
          transactionType,
          amount: normalizedAmount,
          balanceBefore,
          balanceAfter: newBalance,
          status: TRANSACTION_STATUS.SUCCESS,
          phone,
          remarks,
          referenceId,
          referenceType,
        },
      ],
      { session }
    );

    return {
      ...formatWallet(updatedWallet),
      transactionId: transaction._id.toString(),
    };
  }

  if (existingSession) {
    return applyWalletChange(existingSession);
  }

  const session = await mongoose.startSession();

  try {
    let walletChange;

    await session.withTransaction(async () => {
      walletChange = await applyWalletChange(session);
    });

    return walletChange;
  } finally {
    await session.endSession();
  }
}

async function creditWallet({
  userId,
  amount,
  transactionType,
  remarks,
  referenceId,
  referenceType,
  phone,
  session,
} = {}) {
  return updateWalletBalance({
    userId,
    amount,
    transactionType,
    remarks,
    referenceId,
    referenceType,
    phone,
    session,
    isCredit: true,
  });
}

async function debitWallet({
  userId,
  amount,
  transactionType,
  remarks,
  referenceId,
  referenceType,
  phone,
  session,
} = {}) {
  return updateWalletBalance({
    userId,
    amount,
    transactionType,
    remarks,
    referenceId,
    referenceType,
    phone,
    session,
    isCredit: false,
  });
}

async function getTransactions(userId, { page = 1, limit = 10 } = {}) {
  validateUserId(userId);

  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    throw createWalletError("Page must be positive and limit must be 1-100", 400);
  }

  const wallet = await Wallet.findOne({ userId }).select("_id");

  if (!wallet) {
    throw createWalletError("Wallet not found", 404);
  }

  const query = { walletId: wallet._id };
  const [transactions, total] = await Promise.all([
    WalletTransaction.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    WalletTransaction.countDocuments(query),
  ]);

  return {
    transactions: transactions.map(formatTransaction),
    pagination: {
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    },
  };
}

module.exports = {
  getWallet,
  createWallet,
  creditWallet,
  debitWallet,
  getTransactions,
};
