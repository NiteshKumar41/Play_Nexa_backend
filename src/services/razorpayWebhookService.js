const mongoose = require("mongoose");
const PaymentEvent = require("../models/PaymentEvent");
const WalletTransaction = require("../models/WalletTransaction");
const { TRANSACTION_STATUS } = require("../constants/transactionStatus");
const { TRANSACTION_TYPE } = require("../constants/transactionTypes");
const paymentService = require("./paymentService");
const refundService = require("./refundService");
const walletService = require("./walletService");

function error(message, statusCode) {
  const result = new Error(message);
  result.statusCode = statusCode;
  return result;
}

function getEntity(payload, kind) {
  const entity = payload?.payload?.[kind]?.entity;
  if (!entity || typeof entity !== "object") return null;
  return entity;
}

function normalizedRupees(amountInPaise) {
  return Number.isInteger(amountInPaise) && amountInPaise >= 0
    ? amountInPaise / 100
    : undefined;
}

function safeFailureReason(entity) {
  const reason = entity?.error_description || entity?.error_reason || entity?.error_code;
  return typeof reason === "string" && reason.trim()
    ? reason.trim().slice(0, 500)
    : undefined;
}

async function processConfirmedRefundEvent({ eventId, payload }) {
  const refund = getEntity(payload, "refund");
  const providerRefundId = typeof refund?.id === "string" && refund.id.trim()
    ? refund.id.trim()
    : undefined;
  const providerPaymentId = typeof refund?.payment_id === "string" && refund.payment_id.trim()
    ? refund.payment_id.trim()
    : undefined;
  const amount = normalizedRupees(refund?.amount);
  const currency = typeof refund?.currency === "string" ? refund.currency : undefined;

  let event = await PaymentEvent.findOne({ provider: "RAZORPAY", eventId });
  const wasExisting = Boolean(event);
  if (event?.status === "PROCESSED" && event.eventStatus === "PROCESSED") {
    return { received: true, duplicate: true, processed: true };
  }

  let original;
  if (providerPaymentId) {
    original = await WalletTransaction.findOne({
      gatewayPaymentId: providerPaymentId,
    });
  }

  const metadata = {
    ...(event?.metadata && typeof event.metadata === "object" ? event.metadata : {}),
    refundReconciliation: {
      providerRefundId,
      providerPaymentId,
      amountPaise: Number.isInteger(refund?.amount) ? refund.amount : undefined,
      currency,
      sourceEventType: "refund.processed",
    },
  };
  const baseValues = {
    provider: "RAZORPAY",
    eventId,
    eventType: "refund.processed",
    providerEventId: eventId,
    ...(original ? { transactionId: original._id } : {}),
    providerPaymentId,
    providerRefundId,
    ...(amount !== undefined ? { amount } : {}),
    ...(currency === "INR" ? { currency } : {}),
    metadata,
    processedAt: event?.processedAt || new Date(),
  };

  if (!event) {
    try {
      event = await PaymentEvent.create({
        ...baseValues,
        status: "IGNORED",
        eventStatus: "PENDING",
        failureReason: "Refund awaiting validation and wallet processing",
      });
    } catch (caught) {
      if (caught.code !== 11000) throw caught;
      event = await PaymentEvent.findOne({ provider: "RAZORPAY", eventId });
      if (event?.status === "PROCESSED" && event.eventStatus === "PROCESSED") {
        return { received: true, duplicate: true, processed: true };
      }
    }
  } else {
    event.set({ ...baseValues, status: "IGNORED", eventStatus: "PENDING" });
    await event.save();
  }

  let failureReason;
  if (!providerRefundId) failureReason = "Refund ID is missing";
  else if (!providerPaymentId) failureReason = "Payment ID is missing";
  else if (amount === undefined || amount <= 0) failureReason = "Refund amount must be greater than 0";
  else if (currency !== "INR") failureReason = "Refund currency must be INR";
  else if (!original) failureReason = "Original ADD_MONEY transaction not found; refund requires reconciliation";
  else if (original.transactionType !== TRANSACTION_TYPE.ADD_MONEY) failureReason = "Original transaction is not ADD_MONEY";

  if (failureReason) {
    event.eventStatus = original ? "FAILED" : "PENDING";
    event.failureReason = failureReason;
    await event.save();
    return { received: true, duplicate: wasExisting, processed: false, reconciliationRequired: true };
  }

  try {
    await refundService.processConfirmedRefund({
      originalTransaction: original,
      providerRefundId,
      providerPaymentId,
      amount,
    });
    event.status = "PROCESSED";
    event.eventStatus = "PROCESSED";
    event.transactionId = original._id;
    event.failureReason = undefined;
    event.processedAt = new Date();
    await event.save();
    return { received: true, duplicate: wasExisting, processed: true };
  } catch (caught) {
    // Keep the confirmed provider event and all reconciliation identifiers even
    // when refund processing fails. The refund service transaction rolls back
    // wallet and ledger writes together.
    event.status = "IGNORED";
    event.eventStatus = "FAILED";
    event.failureReason = typeof caught.message === "string"
      ? caught.message.slice(0, 500)
      : "Refund processing failed; reconciliation required";
    await event.save();
    return { received: true, duplicate: wasExisting, processed: false, reconciliationRequired: true };
  }
}

async function processRazorpayWebhook({ headers, rawBody }) {
  if (!Buffer.isBuffer(rawBody)) throw error("Raw webhook body is required", 400);
  const signatureValid = await paymentService.verifyWebhook({ headers, rawBody });
  if (!signatureValid) throw error("Invalid Razorpay webhook signature", 400);

  let payload;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw error("Invalid webhook JSON", 400);
  }
  const eventId = headers["x-razorpay-event-id"];
  const eventType = payload.event;
  if (typeof eventId !== "string" || !eventId.trim() || typeof eventType !== "string") {
    throw error("Razorpay event ID and event type are required", 400);
  }

  if (eventType === "refund.processed") {
    return processConfirmedRefundEvent({ eventId: eventId.trim(), payload });
  }

  const priorEvent = await PaymentEvent.findOne({ provider: "RAZORPAY", eventId }).lean();
  if (priorEvent) return { received: true, duplicate: true };

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      let status = "IGNORED";
      let eventStatus = "IGNORED";
      let transactionId;
      let payment;
      let refund;
      let failureReason;
      let refundMetadata;
      if (eventType === "payment.captured") {
        payment = getEntity(payload, "payment");
        if (payment && typeof payment.order_id === "string" && typeof payment.id === "string") {
          const deposit = await WalletTransaction.findOne({
            gatewayOrderId: payment.order_id,
            transactionType: TRANSACTION_TYPE.ADD_MONEY,
          }).session(session);
          if (deposit && deposit.status === TRANSACTION_STATUS.PENDING &&
              Number.isInteger(payment.amount) && payment.amount === Math.round(deposit.amount * 100) &&
              payment.currency === "INR" && payment.status === "captured") {
            const updatedDeposit = await walletService.creditPendingAddMoney({
              transactionId: deposit._id,
              userId: deposit.userId,
              amount: deposit.amount,
              session,
              gatewayOrderId: payment.order_id,
              gatewayPaymentId: payment.id,
              gatewayStatus: payment.status || eventType,
              remarks: "Razorpay payment captured",
            });
            status = "PROCESSED";
            eventStatus = "PROCESSED";
            transactionId = updatedDeposit.transactionId;
          }
        }
      } else if (eventType === "payment.failed") {
        payment = getEntity(payload, "payment");
        eventStatus = "FAILED";
        failureReason = safeFailureReason(payment);
      } else if (eventType === "payment.authorized") {
        payment = getEntity(payload, "payment");
        eventStatus = "PENDING";
      } else if (["refund.created", "refund.processed", "refund.failed"].includes(eventType)) {
        refund = getEntity(payload, "refund");
        payment = refund;
        eventStatus = eventType === "refund.failed"
          ? "FAILED"
          : eventType === "refund.processed" ? "PROCESSED" : "PENDING";
        failureReason = eventType === "refund.failed" ? safeFailureReason(refund) : undefined;
        const providerPaymentId = typeof refund?.payment_id === "string" ? refund.payment_id : undefined;
        const originalDeposit = providerPaymentId
          ? await WalletTransaction.findOne({
            gatewayPaymentId: providerPaymentId,
            transactionType: TRANSACTION_TYPE.ADD_MONEY,
          }).session(session)
          : null;

        if (originalDeposit) {
          transactionId = originalDeposit._id;
          const refundAmount = normalizedRupees(refund?.amount);
          if (refundAmount !== undefined) {
            refundMetadata = {
              classification: refundAmount >= originalDeposit.amount ? "FULL" : "PARTIAL",
              originalTransactionAmount: originalDeposit.amount,
            };
          }
        } else {
          // Preserve the refund event so it can be reconciled when the original
          // payment record becomes available. No wallet operation is performed.
          if (eventStatus !== "FAILED") eventStatus = "PENDING";
          const reconciliationReason = "Original ADD_MONEY transaction not found for provider payment ID";
          failureReason = failureReason
            ? `${reconciliationReason}; provider reason: ${failureReason}`.slice(0, 500)
            : reconciliationReason;
        }
      }

      const eventRecord = {
        provider: "RAZORPAY",
        eventId,
        eventType,
        providerEventId: eventId,
        transactionId,
        status,
        eventStatus,
        providerPaymentId: typeof payment?.payment_id === "string"
          ? payment.payment_id
          : eventType.startsWith("payment.") && typeof payment?.id === "string" ? payment.id : undefined,
        providerRefundId: typeof refund?.id === "string" ? refund.id : undefined,
        amount: normalizedRupees(refund?.amount ?? payment?.amount),
        currency: (refund?.currency ?? payment?.currency) === "INR" ? "INR" : undefined,
        failureReason,
        metadata: refundMetadata,
        ...(eventType === "refund.processed" ? { processedAt: new Date() } : {}),
        ...(eventType === "refund.failed" ? { failedAt: new Date() } : {}),
      };
      await PaymentEvent.create([eventRecord], { session });
    });
    return { received: true, duplicate: false };
  } catch (caught) {
    if (caught.code === 11000) return { received: true, duplicate: true };
    throw caught;
  } finally {
    await session.endSession();
  }
}

module.exports = { processRazorpayWebhook };
