const mongoose = require("mongoose");

const gameSchema = new mongoose.Schema(
  {
    gameCode: {
      type: Number,
      required: true,
      unique: true,
      min: 1,
      validate: {
        validator: Number.isSafeInteger,
        message: "Game code must be a positive integer",
      },
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    imageUrl: {
      type: String,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isOpen: {
      type: Boolean,
      default: false,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  }
);

gameSchema.index(
  { name: 1 },
  { unique: true, collation: { locale: "en", strength: 2 } }
);

module.exports = mongoose.model("Game", gameSchema);
