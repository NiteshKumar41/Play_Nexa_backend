const mongoose = require("mongoose");
const PaymentMethod = require("../models/PaymentMethod");
const fileStorage = require("../utils/fileStorage");

function createPaymentMethodError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function validateObjectId(value) {
  if (!mongoose.isValidObjectId(value)) {
    throw createPaymentMethodError("Invalid payment method ID", 400);
  }
}

function normalizeRequiredText(value, label) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > 200
  ) {
    throw createPaymentMethodError(`${label} is required and must be 200 characters or fewer`, 400);
  }
  return value.trim();
}

function normalizeUpiId(value) {
  const upiId = normalizeRequiredText(value, "UPI ID");
  if (!/^[^@\s]+@[^@\s]+$/.test(upiId)) {
    throw createPaymentMethodError("Enter a valid UPI ID", 400);
  }
  return upiId;
}

function formatPaymentMethod(paymentMethod) {
  return {
    id: paymentMethod._id.toString(),
    upiId: paymentMethod.upiId,
    payeeName: paymentMethod.payeeName,
    qrUrl: paymentMethod.qrUrl || null,
    status: paymentMethod.status,
    createdAt: paymentMethod.createdAt,
    updatedAt: paymentMethod.updatedAt,
  };
}

async function getActivePaymentMethod() {
  const paymentMethod = await PaymentMethod.findOne({ status: true }).lean();
  if (!paymentMethod) {
    throw createPaymentMethodError(
      "No active payment method is available",
      404
    );
  }
  return {
    upiId: paymentMethod.upiId,
    payeeName: paymentMethod.payeeName,
    qrUrl: paymentMethod.qrUrl || null,
  };
}

async function getPaymentMethods(query = {}) {
  const page = Number(query.page ?? 1);
  const limit = Number(query.limit ?? 20);
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    throw createPaymentMethodError(
      "Page must be positive and limit must be 1-100",
      400
    );
  }
  const [paymentMethods, total] = await Promise.all([
    PaymentMethod.find({})
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    PaymentMethod.countDocuments({}),
  ]);
  return {
    paymentMethods: paymentMethods.map(formatPaymentMethod),
    pagination: {
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    },
  };
}

async function createPaymentMethod(adminId, data, qrFile) {
  if (!data || typeof data !== "object") {
    throw createPaymentMethodError("Payment method details are required", 400);
  }
  const upiId = normalizeUpiId(data.upiId);
  const payeeName = normalizeRequiredText(data.payeeName, "Payee name");
  if (!qrFile) {
    throw createPaymentMethodError(
      "QR image is required when creating a payment method",
      400
    );
  }
  if (data.status !== undefined) {
    throw createPaymentMethodError(
      "Use the activate endpoint to change payment method status",
      400
    );
  }

  let qrFileName;
  try {
    if (qrFile) qrFileName = await fileStorage.savePaymentMethodQr(qrFile);
    const paymentMethodId = new mongoose.Types.ObjectId();
    const [paymentMethod] = await PaymentMethod.create([
      {
        _id: paymentMethodId,
        upiId,
        payeeName,
        qrUrl: qrFileName
          ? fileStorage.getPaymentMethodQrUrl(paymentMethodId, qrFileName)
          : null,
        qrFileName: qrFileName || null,
        status: false,
        createdBy: adminId,
        updatedBy: adminId,
      },
    ]);
    return formatPaymentMethod(paymentMethod);
  } catch (error) {
    if (qrFileName) await fileStorage.deletePaymentMethodQr(qrFileName);
    throw error;
  }
}

async function updatePaymentMethod(paymentMethodId, adminId, data, qrFile) {
  validateObjectId(paymentMethodId);
  if (!data || typeof data !== "object") {
    throw createPaymentMethodError("Payment method details are required", 400);
  }

  const allowedFields = ["upiId", "payeeName", "status"];
  if (Object.keys(data).some(field => !allowedFields.includes(field))) {
    throw createPaymentMethodError("Payment method request contains unsupported fields", 400);
  }
  if (data.status !== undefined && typeof data.status !== "boolean") {
    throw createPaymentMethodError("Status must be a boolean", 400);
  }

  const paymentMethod = await PaymentMethod.findById(paymentMethodId).select(
    "+qrFileName"
  );
  if (!paymentMethod) {
    throw createPaymentMethodError("Payment method not found", 404);
  }

  if (data.upiId !== undefined) {
    paymentMethod.upiId = normalizeUpiId(data.upiId);
  }
  if (data.payeeName !== undefined) {
    paymentMethod.payeeName = normalizeRequiredText(data.payeeName, "Payee name");
  }

  const previousQrFileName = paymentMethod.qrFileName;
  let newQrFileName;
  if (qrFile) {
    newQrFileName = await fileStorage.savePaymentMethodQr(qrFile);
    paymentMethod.qrFileName = newQrFileName;
    paymentMethod.qrUrl = fileStorage.getPaymentMethodQrUrl(
      paymentMethod._id,
      newQrFileName
    );
  }
  paymentMethod.updatedBy = adminId;

  try {
    await paymentMethod.save();
  } catch (error) {
    if (newQrFileName) await fileStorage.deletePaymentMethodQr(newQrFileName);
    throw error;
  }

  if (
    newQrFileName &&
    previousQrFileName &&
    previousQrFileName !== newQrFileName
  ) {
    try {
      await fileStorage.deletePaymentMethodQr(previousQrFileName);
    } catch (error) {
      console.error("Unable to remove replaced payment method QR:", error.message);
    }
  }

  if (data.status === true) {
    return activatePaymentMethod(paymentMethodId, adminId);
  }
  if (data.status === false && paymentMethod.status) {
    paymentMethod.status = false;
    await paymentMethod.save();
  }

  return formatPaymentMethod(paymentMethod);
}

async function activatePaymentMethod(paymentMethodId, adminId) {
  validateObjectId(paymentMethodId);
  const session = await mongoose.startSession();
  let activatedMethod;

  try {
    await session.withTransaction(async () => {
      const paymentMethod = await PaymentMethod.findById(paymentMethodId).session(
        session
      );
      if (!paymentMethod) {
        throw createPaymentMethodError("Payment method not found", 404);
      }

      await PaymentMethod.updateMany(
        { status: true, _id: { $ne: paymentMethodId } },
        { $set: { status: false, updatedBy: adminId } },
        { session }
      );
      paymentMethod.status = true;
      paymentMethod.updatedBy = adminId;
      await paymentMethod.save({ session });
      activatedMethod = paymentMethod;
    });
    return formatPaymentMethod(activatedMethod);
  } finally {
    await session.endSession();
  }
}

async function deletePaymentMethod(paymentMethodId) {
  validateObjectId(paymentMethodId);
  const paymentMethod = await PaymentMethod.findById(paymentMethodId).select(
    "+qrFileName"
  );
  if (!paymentMethod) {
    throw createPaymentMethodError("Payment method not found", 404);
  }
  if (paymentMethod.status) {
    throw createPaymentMethodError(
      "Cannot delete the active payment method",
      409
    );
  }

  await PaymentMethod.deleteOne({ _id: paymentMethodId });
  if (paymentMethod.qrFileName) {
    try {
      await fileStorage.deletePaymentMethodQr(paymentMethod.qrFileName);
    } catch (error) {
      console.error("Unable to remove deleted payment method QR:", error.message);
    }
  }
}

async function getPaymentMethodQr(paymentMethodId, fileName, role) {
  validateObjectId(paymentMethodId);
  const paymentMethod = await PaymentMethod.findById(paymentMethodId)
    .select("+qrFileName")
    .lean();
  if (!paymentMethod) {
    throw createPaymentMethodError("Payment method not found", 404);
  }
  if (role !== "admin" && !paymentMethod.status) {
    throw createPaymentMethodError("Payment method not found", 404);
  }
  if (
    paymentMethod.qrUrl !==
    fileStorage.getPaymentMethodQrUrl(paymentMethodId, fileName)
  ) {
    throw createPaymentMethodError("QR image not found", 404);
  }

  return {
    buffer: await fileStorage.readPaymentMethodQr(fileName),
    contentType: fileStorage.getFileContentType(fileName),
  };
}

module.exports = {
  getActivePaymentMethod,
  getPaymentMethods,
  createPaymentMethod,
  updatePaymentMethod,
  activatePaymentMethod,
  deletePaymentMethod,
  getPaymentMethodQr,
};
