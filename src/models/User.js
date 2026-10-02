const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    fullName: {
      type: String,
      required: true,
      trim: true,
    },
    dob: {
      type: Date,
    },
    gender: {
      type: String,
      trim: true,
    },
    upiId: {
      type: String,
      trim: true,
    },
    password: {
      type: String,
      required: true,
      select: false,
    },
    role: {
      type: String,
      default: "player",
    },
    adminUpdatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    adminSafetyVersion: {
      type: Number,
      default: 0,
      select: false,
    },
    active: {
      type: Boolean,
      default: true,
    },
    isBlocked: {
      type: Boolean,
      default: false,
    },
    fcmToken: {
      type: String,
    },
    appVersion: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

userSchema.index({ role: 1, active: 1, isBlocked: 1 });

module.exports = mongoose.model("User", userSchema);
