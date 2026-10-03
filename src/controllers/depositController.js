const depositService = require("../services/depositService");

async function createDeposit(request, response, next) {
  try {
    const deposit = await depositService.createDeposit(
      request.user.id,
      request.body,
      request.file
    );
    return response.status(201).json({
      success: true,
      message: "Deposit request submitted successfully",
      data: {
        transactionId: deposit.transactionId,
        amount: deposit.amount,
        status: deposit.status,
        proofUrl: deposit.proofUrl,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function verifyRazorpayPayment(request, response, next) {
  try {
    const fields = ["razorpay_order_id", "razorpay_payment_id", "razorpay_signature"];
    if (!request.body || typeof request.body !== "object" || Array.isArray(request.body) ||
        Object.keys(request.body).length !== fields.length || fields.some(field => typeof request.body[field] !== "string" || !request.body[field].trim())) {
      const error = new Error("Only Razorpay order, payment, and signature identifiers are required");
      error.statusCode = 400;
      throw error;
    }
    const data = await depositService.verifyRazorpayDeposit(request.user.id, request.body);
    return response.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
}

async function getUserDeposits(request, response, next) {
  try {
    const data = await depositService.getUserDeposits(
      request.user.id,
      request.query
    );
    return response.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
}

async function getDepositProof(request, response, next) {
  try {
    const proof = await depositService.getDepositProof(
      request.params.transactionId,
      request.params.fileName,
      request.user.id,
      request.user.role
    );
    response.set("Content-Type", proof.contentType);
    response.set("Cache-Control", "private, no-store");
    response.set("X-Content-Type-Options", "nosniff");
    return response.send(proof.buffer);
  } catch (error) {
    return next(error);
  }
}

module.exports = { createDeposit, verifyRazorpayPayment, getUserDeposits, getDepositProof };
