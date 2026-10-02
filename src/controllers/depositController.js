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

module.exports = { createDeposit, getUserDeposits, getDepositProof };
