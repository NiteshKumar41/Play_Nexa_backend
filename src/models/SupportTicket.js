const mongoose = require("mongoose");

const SUPPORT_TICKET_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "RESOLVED",
  "CLOSED",
];

const supportTicketSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    transactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WalletTransaction",
      default: null,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
      minlength: 3,
      maxlength: 150,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      minlength: 10,
      maxlength: 2000,
    },
    imageUrl: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: SUPPORT_TICKET_STATUSES,
      default: "OPEN",
      required: true,
    },
    resolution: {
      type: String,
      trim: true,
      default: null,
      maxlength: 2000,
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
    closedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

supportTicketSchema.index({ userId: 1, createdAt: -1 });
supportTicketSchema.index({ status: 1, createdAt: -1 });
supportTicketSchema.index({ transactionId: 1 });

module.exports = mongoose.model("SupportTicket", supportTicketSchema);
