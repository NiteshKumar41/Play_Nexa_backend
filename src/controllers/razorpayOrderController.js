const { createRazorpayDepositOrder } = require("../services/razorpayOrderService");

async function createOrder(request, response, next) {
  try {
    const data = await createRazorpayDepositOrder(request.user.userId, request.body);
    return response.status(201).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
}

module.exports = { createOrder };
