const mongoose = require("mongoose");
const { TRANSACTION_TYPE } = require("../constants/transactionTypes");
const { TRANSACTION_STATUS } = require("../constants/transactionStatus");

const walletTransactionSchema = new mongoose.Schema(
  {
    walletId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Wallet",
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    upiId: {
      type: String,
      trim: true,
    },
    upiApp: {
      type: String,
      trim: true,
      maxlength: 100,
    },
    upiTransactionId: {
      type: String,
      trim: true,
      maxlength: 200,
    },
    gatewayOrderId: {
      type: String,
    },
    gatewayPaymentId: {
      type: String,
    },
    providerRefundId: {
      type: String,
      trim: true,
    },
    originalTransactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WalletTransaction",
    },
    gatewaySignature: {
      type: String,
    },
    gatewayStatus: {
      type: String,
    },
    clientRequestId: {
      type: String,
      trim: true,
      maxlength: 128,
    },
    proofUrl: {
      type: String,
      trim: true,
    },
    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    processedAt: {
      type: Date,
    },
    transactionType: {
      type: String,
      enum: Object.values(TRANSACTION_TYPE),
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: Number.MIN_VALUE,
    },
    balanceBefore: {
      type: Number,
      required: true,
      min: 0,
    },
    balanceAfter: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: Object.values(TRANSACTION_STATUS),
      required: true,
    },
    remarks: {
      type: String,
      trim: true,
    },
    referenceId: {
      type: String,
      trim: true,
    },
    referenceType: {
      type: String,
      enum: ["MATCH_SETTLEMENT", "MATCH_REFUND", "WITHDRAWAL", "ADD_MONEY_REFUND"],
    },
  },
  {
    timestamps: true,
  }
);

walletTransactionSchema.index({ walletId: 1, createdAt: -1 });
walletTransactionSchema.index({ userId: 1, createdAt: -1 });
walletTransactionSchema.index({ transactionType: 1, status: 1, createdAt: 1 });
walletTransactionSchema.index({
  userId: 1,
  transactionType: 1,
  status: 1,
  createdAt: -1,
});
walletTransactionSchema.index(
  { userId: 1, transactionType: 1, clientRequestId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      transactionType: "WITHDRAW",
      clientRequestId: { $type: "string" },
    },
  }
);
walletTransactionSchema.index(
  { userId: 1, transactionType: 1, clientRequestId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      transactionType: "ADD_MONEY",
      clientRequestId: { $type: "string" },
    },
  }
);
walletTransactionSchema.index({ gatewayOrderId: 1 });
walletTransactionSchema.index(
  { providerRefundId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      transactionType: "ADD_MONEY_REFUND",
      providerRefundId: { $type: "string" },
    },
  }
);
walletTransactionSchema.index(
  { userId: 1, transactionType: 1, upiTransactionId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      transactionType: "ADD_MONEY",
      upiTransactionId: { $type: "string" },
    },
  }
);
walletTransactionSchema.index({ referenceType: 1, referenceId: 1 });
walletTransactionSchema.index(
  { transactionType: 1, referenceType: 1, referenceId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      transactionType: "GAME_WIN",
      referenceType: "MATCH_SETTLEMENT",
      status: "SUCCESS",
    },
  }
);
walletTransactionSchema.index(
  { userId: 1, transactionType: 1, referenceType: 1, referenceId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      transactionType: "GAME_REFUND",
      referenceType: "MATCH_REFUND",
      status: "SUCCESS",
    },
  }
);
walletTransactionSchema.index(
  { transactionType: 1, referenceType: 1, referenceId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      transactionType: "WITHDRAW_REFUND",
      referenceType: "WITHDRAWAL",
      status: "SUCCESS",
    },
  }
);

module.exports = mongoose.model("WalletTransaction", walletTransactionSchema);
