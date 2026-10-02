const mongoose = require("mongoose");

const paymentMethodSchema = new mongoose.Schema(
  {
    upiId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    payeeName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    qrUrl: {
      type: String,
      default: null,
    },
    qrFileName: {
      type: String,
      default: null,
      select: false,
    },
    status: {
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
      required: true,
    },
  },
  { timestamps: true }
);

paymentMethodSchema.index(
  { status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: true },
  }
);

module.exports = mongoose.model("PaymentMethod", paymentMethodSchema);
