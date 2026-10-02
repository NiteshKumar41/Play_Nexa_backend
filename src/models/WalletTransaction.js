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
      enum: ["MATCH_SETTLEMENT", "MATCH_REFUND"],
    },
  },
  {
    timestamps: true,
  }
);

walletTransactionSchema.index({ walletId: 1, createdAt: -1 });
walletTransactionSchema.index({ userId: 1, createdAt: -1 });
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

module.exports = mongoose.model("WalletTransaction", walletTransactionSchema);
