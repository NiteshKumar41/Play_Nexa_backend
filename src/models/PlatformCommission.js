const mongoose = require("mongoose");

const platformCommissionSchema = new mongoose.Schema(
  {
    matchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GameMatch",
      required: true,
    },
    entryAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    grossWinningAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    commissionRate: {
      type: Number,
      required: true,
      min: 0,
    },
    commissionAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    settlementReference: {
      type: String,
      required: true,
      trim: true,
    },
    // This is an accounting record only. It is not a player wallet balance.
    accountingStatus: {
      type: String,
      enum: ["RECORDED"],
      default: "RECORDED",
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

platformCommissionSchema.index({ matchId: 1 }, { unique: true });
platformCommissionSchema.index(
  { settlementReference: 1 },
  { unique: true }
);

module.exports = mongoose.model("PlatformCommission", platformCommissionSchema);
