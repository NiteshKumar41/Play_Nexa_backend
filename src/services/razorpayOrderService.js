const mongoose = require("mongoose");
const User = require("../models/User");
const Wallet = require("../models/Wallet");
const WalletTransaction = require("../models/WalletTransaction");
const { TRANSACTION_STATUS } = require("../constants/transactionStatus");
const { TRANSACTION_TYPE } = require("../constants/transactionTypes");
const { roundMoney } = require("../utils/money");
const paymentService = require("./paymentService");

function orderError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function validateRequest(userId, data) {
  if (!mongoose.isValidObjectId(userId)) throw orderError("Invalid user", 400);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw orderError("Order details are required", 400);
  const keys = Object.keys(data);
  if (keys.some(key => !["amount", "clientRequestId"].includes(key))) {
    throw orderError("Only amount and clientRequestId are accepted", 400);
  }
  if (typeof data.amount !== "number" || !Number.isFinite(data.amount) || data.amount <= 0) {
    throw orderError("Amount must be a number greater than 0", 400);
  }
  let amount;
  try { amount = roundMoney(data.amount); }
  catch { throw orderError("Amount is outside the supported range", 400); }
  if (amount <= 0) throw orderError("Amount must be at least 0.01", 400);
  if (typeof data.clientRequestId !== "string" || !data.clientRequestId.trim() || data.clientRequestId.trim().length > 128) {
    throw orderError("clientRequestId must be between 1 and 128 characters", 400);
  }
  return { amount, clientRequestId: data.clientRequestId.trim() };
}

function formatOrder(transaction) {
  return {
    transactionId: transaction._id.toString(),
    amount: transaction.amount,
    status: transaction.status,
    gatewayOrderId: transaction.gatewayOrderId,
  };
}

async function createRazorpayDepositOrder(userId, requestData) {
  const { amount, clientRequestId } = validateRequest(userId, requestData);
  const findExisting = () => WalletTransaction.findOne({
    userId,
    transactionType: TRANSACTION_TYPE.ADD_MONEY,
    clientRequestId,
  });
  let transaction = await findExisting();
  if (transaction) {
    if (transaction.amount !== amount) throw orderError("clientRequestId was already used for a different amount", 409);
    if (transaction.status !== TRANSACTION_STATUS.PENDING) throw orderError("Deposit request has already been processed", 409);
    if (transaction.gatewayOrderId) return formatOrder(transaction);
  } else {
    const [user, wallet] = await Promise.all([
      User.findById(userId).select("_id phone"),
      Wallet.findOne({ userId }).select("_id balance userId"),
    ]);
    if (!user || !wallet || wallet.userId.toString() !== userId.toString()) throw orderError("Wallet not found", 404);
    try {
      [transaction] = await WalletTransaction.create([{
        userId,
        walletId: wallet._id,
        phone: user.phone,
        transactionType: TRANSACTION_TYPE.ADD_MONEY,
        amount,
        balanceBefore: roundMoney(wallet.balance),
        balanceAfter: roundMoney(wallet.balance),
        status: TRANSACTION_STATUS.PENDING,
        clientRequestId,
        remarks: "Razorpay deposit order created",
      }]);
    } catch (error) {
      if (error.code !== 11000) throw error;
      transaction = await findExisting();
      if (!transaction) throw error;
      if (transaction.amount !== amount) throw orderError("clientRequestId was already used for a different amount", 409);
      if (transaction.status !== TRANSACTION_STATUS.PENDING) throw orderError("Deposit request has already been processed", 409);
      if (transaction.gatewayOrderId) return formatOrder(transaction);
    }
  }

  const providerOrder = await paymentService.createOrder({
    transaction,
    idempotencyKey: transaction._id.toString(),
  });
  if (!providerOrder || typeof providerOrder.id !== "string" || !providerOrder.id ||
      providerOrder.amount !== Math.round(amount * 100) || providerOrder.currency !== "INR") {
    throw orderError("Razorpay returned an invalid order", 502);
  }
  const updated = await WalletTransaction.findOneAndUpdate(
    { _id: transaction._id, userId, transactionType: TRANSACTION_TYPE.ADD_MONEY, status: TRANSACTION_STATUS.PENDING, gatewayOrderId: { $exists: false } },
    { $set: { gatewayOrderId: providerOrder.id, gatewayStatus: providerOrder.status || "created" } },
    { new: true, runValidators: true }
  );
  if (updated) return formatOrder(updated);
  const reloaded = await WalletTransaction.findById(transaction._id);
  if (reloaded?.gatewayOrderId && reloaded.status === TRANSACTION_STATUS.PENDING) return formatOrder(reloaded);
  throw orderError("Could not store Razorpay order", 409);
}

module.exports = { createRazorpayDepositOrder };
