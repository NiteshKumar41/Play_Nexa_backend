const mongoose = require("mongoose");

const paymentEventSchema = new mongoose.Schema({
  provider: { type: String, required: true, enum: ["RAZORPAY"] },
  eventId: { type: String, required: true, trim: true },
  eventType: { type: String, required: true, trim: true },
  transactionId: { type: mongoose.Schema.Types.ObjectId, ref: "WalletTransaction" },
  // `status` remains for compatibility with existing records and callers.
  status: { type: String, enum: ["PROCESSED", "IGNORED"] },
  eventStatus: { type: String, enum: ["PENDING", "PROCESSED", "FAILED", "IGNORED"] },
  providerEventId: { type: String, trim: true },
  providerPaymentId: { type: String, trim: true },
  providerRefundId: { type: String, trim: true },
  amount: { type: Number, min: 0 },
  currency: { type: String, enum: ["INR"] },
  failureReason: { type: String, trim: true },
  processedAt: { type: Date, required: true, default: Date.now },
  failedAt: { type: Date },
  metadata: { type: mongoose.Schema.Types.Mixed },
}, { timestamps: true });

paymentEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });
paymentEventSchema.index({ providerEventId: 1 }, { sparse: true });
paymentEventSchema.index({ providerPaymentId: 1 }, { sparse: true });
paymentEventSchema.index({ providerRefundId: 1 }, { sparse: true });

module.exports = mongoose.models.PaymentEvent || mongoose.model("PaymentEvent", paymentEventSchema);
