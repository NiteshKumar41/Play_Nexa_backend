const paymentMethodService = require("../services/paymentMethodService");

async function getActivePaymentMethod(request, response, next) {
  try {
    const paymentMethod = await paymentMethodService.getActivePaymentMethod();
    return response.status(200).json({
      success: true,
      data: { paymentMethod },
    });
  } catch (error) {
    return next(error);
  }
}

async function getPaymentMethods(request, response, next) {
  try {
    const data = await paymentMethodService.getPaymentMethods(request.query);
    return response.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return next(error);
  }
}

async function createPaymentMethod(request, response, next) {
  try {
    const paymentMethod = await paymentMethodService.createPaymentMethod(
      request.user.id,
      request.body,
      request.file
    );
    return response.status(201).json({
      success: true,
      message: "Payment method created successfully",
      data: { paymentMethod },
    });
  } catch (error) {
    return next(error);
  }
}

async function updatePaymentMethod(request, response, next) {
  try {
    const paymentMethod = await paymentMethodService.updatePaymentMethod(
      request.params.paymentMethodId,
      request.user.id,
      request.body,
      request.file
    );
    return response.status(200).json({
      success: true,
      message: "Payment method updated successfully",
      data: { paymentMethod },
    });
  } catch (error) {
    return next(error);
  }
}

async function activatePaymentMethod(request, response, next) {
  try {
    const paymentMethod = await paymentMethodService.activatePaymentMethod(
      request.params.paymentMethodId,
      request.user.id
    );
    return response.status(200).json({
      success: true,
      message: "Payment method activated successfully",
      data: { paymentMethod },
    });
  } catch (error) {
    return next(error);
  }
}

async function deletePaymentMethod(request, response, next) {
  try {
    await paymentMethodService.deletePaymentMethod(
      request.params.paymentMethodId
    );
    return response.status(200).json({
      success: true,
      message: "Payment method deleted successfully",
    });
  } catch (error) {
    return next(error);
  }
}

async function getPaymentMethodQr(request, response, next) {
  try {
    const qr = await paymentMethodService.getPaymentMethodQr(
      request.params.paymentMethodId,
      request.params.fileName,
      request.user.role
    );
    response.set("Content-Type", qr.contentType);
    response.set("Cache-Control", "private, no-store");
    response.set("X-Content-Type-Options", "nosniff");
    return response.send(qr.buffer);
  } catch (error) {
    return next(error);
  }
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
