const mongoose = require("mongoose");
const WalletTransaction = require("../models/WalletTransaction");
const walletService = require("./walletService");
const { TRANSACTION_TYPE } = require("../constants/transactionTypes");
const { TRANSACTION_STATUS } = require("../constants/transactionStatus");
const { roundMoney, addMoney, subtractMoney } = require("../utils/money");

function refundError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function validateRequiredString(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw refundError(`${name} is required`);
  }
  return value.trim();
}

function formatResult(transaction) {
  return {
    transactionId: transaction._id.toString(),
    originalTransactionId: transaction.originalTransactionId.toString(),
    providerRefundId: transaction.providerRefundId,
    providerPaymentId: transaction.gatewayPaymentId,
    amount: transaction.amount,
    status: transaction.status,
    balanceBefore: transaction.balanceBefore,
    balanceAfter: transaction.balanceAfter,
  };
}

/** Process a provider-confirmed refund. This function does not contact a payment provider. */
async function processConfirmedRefund({
  originalTransaction,
  providerRefundId,
  amount,
  providerPaymentId,
} = {}) {
  const originalId = typeof originalTransaction === "string"
    ? originalTransaction
    : originalTransaction?._id;
  if (!mongoose.isValidObjectId(originalId)) {
    throw refundError("A valid original WalletTransaction is required");
  }
  providerRefundId = validateRequiredString(providerRefundId, "providerRefundId");
  providerPaymentId = validateRequiredString(providerPaymentId, "providerPaymentId");
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 || roundMoney(amount) <= 0) {
    throw refundError("Refund amount must be greater than 0");
  }
  amount = roundMoney(amount);

  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const existing = await WalletTransaction.findOne({
        transactionType: TRANSACTION_TYPE.ADD_MONEY_REFUND,
        providerRefundId,
      }).session(session);
      if (existing) {
        if (existing.originalTransactionId.toString() !== originalId.toString() ||
            existing.gatewayPaymentId !== providerPaymentId || existing.amount !== amount) {
          throw refundError("providerRefundId was already used for a different refund", 409);
        }
        result = formatResult(existing);
        return;
      }

      const original = await WalletTransaction.findById(originalId).session(session);
      if (!original) throw refundError("Original wallet transaction not found", 404);
      if (original.transactionType !== TRANSACTION_TYPE.ADD_MONEY) {
        throw refundError("Original transaction is not an ADD_MONEY transaction", 409);
      }
      if (original.status !== TRANSACTION_STATUS.SUCCESS) {
        throw refundError("Original deposit is not successful", 409);
      }
      if (original.gatewayPaymentId !== providerPaymentId) {
        throw refundError("Original transaction does not belong to this payment", 409);
      }

      const priorRefunds = await WalletTransaction.find({
        transactionType: TRANSACTION_TYPE.ADD_MONEY_REFUND,
        originalTransactionId: original._id,
        status: TRANSACTION_STATUS.SUCCESS,
      }).select("amount").session(session);
      const refunded = priorRefunds.reduce((sum, refund) => addMoney(sum, refund.amount), 0);
      const refundable = subtractMoney(original.amount, refunded);
      if (amount > refundable) throw refundError("Refund amount exceeds the refundable amount", 409);

      const walletChange = await walletService.debitWallet({
        userId: original.userId,
        amount,
        transactionType: TRANSACTION_TYPE.ADD_MONEY_REFUND,
        remarks: "Razorpay payment refund",
        referenceId: original._id.toString(),
        referenceType: "ADD_MONEY_REFUND",
        gatewayPaymentId: providerPaymentId,
        providerRefundId,
        originalTransactionId: original._id,
        session,
      });
      const transaction = await WalletTransaction.findOne({
        _id: walletChange.transactionId,
      }).session(session);
      result = formatResult(transaction);
    });
    return result;
  } catch (error) {
    // A concurrent retry may win the unique providerRefundId index race.
    if (error.code === 11000) {
      const existing = await WalletTransaction.findOne({
        transactionType: TRANSACTION_TYPE.ADD_MONEY_REFUND,
        providerRefundId,
      });
      if (existing && existing.originalTransactionId.toString() === originalId.toString() &&
          existing.gatewayPaymentId === providerPaymentId && existing.amount === amount) {
        return formatResult(existing);
      }
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

module.exports = { processConfirmedRefund };
