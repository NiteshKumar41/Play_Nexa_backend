const mongoose = require("mongoose");
const { MATCH_STATUS } = require("../constants/matchStatus");
const { WINNER_CLAIM_STATUS } = require("../constants/winnerClaimStatus");

const gameMatchSchema = new mongoose.Schema(
  {
    gameId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Game",
      required: true,
    },
    gameCode: {
      type: Number,
      required: true,
    },
    roomCode: {
      type: String,
      default: "",
      trim: true,
    },
    player1: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    player1Name: {
      type: String,
      required: true,
    },
    player1Phone: {
      type: String,
      required: true,
    },
    player1Amount: {
      type: Number,
      required: true,
      min: Number.MIN_VALUE,
    },
    player2: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    player2Name: {
      type: String,
      default: null,
    },
    player2Phone: {
      type: String,
      default: null,
    },
    player2Amount: {
      type: Number,
      default: null,
      min: Number.MIN_VALUE,
    },
    walletTransactionIdPlayer1: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WalletTransaction",
      required: true,
    },
    walletTransactionIdPlayer2: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WalletTransaction",
      default: null,
    },
    winnerPlayer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    p1Screenshot: {
      type: String,
      default: null,
    },
    p2Screenshot: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: Object.values(MATCH_STATUS),
      default: MATCH_STATUS.ACTIVE,
      required: true,
    },
    winnerClaimedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    winnerClaimStatus: {
      type: String,
      enum: [...Object.values(WINNER_CLAIM_STATUS), null],
      default: null,
    },
    winnerClaimRemarks: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: null,
    },
    prizePool: {
      type: Number,
      required: true,
      min: 0,
    },
    platformFee: {
      type: Number,
      default: 0,
      min: 0,
    },
    winnerAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    createdName: {
      type: String,
      required: true,
    },
    disputeReason: {
      type: String,
      default: null,
    },
    disputeClaimedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    rejectionReason: {
      type: String,
      default: null,
    },
    settledAt: {
      type: Date,
      default: null,
    },
    settledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    settlementAction: {
      type: String,
      enum: ["DECLARE_WINNER", "REFUND_BOTH", "REJECT_CLAIM", null],
      default: null,
    },
    settlementReason: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
    },
    refundAmountPerPlayer: {
      type: Number,
      min: 0,
      default: null,
    },
    settlementWalletTransactionIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "WalletTransaction",
      },
    ],
    joinedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

gameMatchSchema.index({ gameId: 1, status: 1, createdAt: -1 });
gameMatchSchema.index({ player1: 1, createdAt: -1 });
gameMatchSchema.index({ player2: 1, createdAt: -1 });
gameMatchSchema.index({ status: 1, createdAt: 1 });
gameMatchSchema.index({
  status: 1,
  winnerClaimStatus: 1,
  completedAt: 1,
  createdAt: 1,
});

module.exports = mongoose.model("GameMatch", gameMatchSchema);
