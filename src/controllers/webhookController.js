const { processRazorpayWebhook } = require("../services/razorpayWebhookService");

async function razorpay(request, response, next) {
  try {
    const result = await processRazorpayWebhook({
      headers: request.headers,
      rawBody: request.rawBody,
    });
    return response.status(200).json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
}

module.exports = { razorpay };
