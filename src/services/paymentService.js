let providerAdapter = null;
const RazorpayProvider = require("./paymentProviders/RazorpayProvider");

function getProviderAdapter() {
  if (!providerAdapter) {
    providerAdapter = new RazorpayProvider();
  }
  return providerAdapter;
}

function setProviderAdapter(adapter) {
  if (adapter !== null) {
    const requiredMethods = [
      "createOrder",
      "verifyPayment",
      "verifyWebhook",
      "refundPayment",
    ];
    if (
      !adapter ||
      requiredMethods.some(method => typeof adapter[method] !== "function")
    ) {
      throw new TypeError(
        `Payment provider adapter must implement: ${requiredMethods.join(", ")}`
      );
    }
  }
  providerAdapter = adapter;
}

function createOrder({ transaction, idempotencyKey }) {
  return getProviderAdapter().createOrder({ transaction, idempotencyKey });
}

function verifyPayment({ transaction, paymentData }) {
  return getProviderAdapter().verifyPayment({ transaction, paymentData });
}

function verifyWebhook({ headers, rawBody }) {
  return getProviderAdapter().verifyWebhook({ headers, rawBody });
}

function refundPayment({ transaction, amount, idempotencyKey }) {
  return getProviderAdapter().refundPayment({
    transaction,
    amount,
    idempotencyKey,
  });
}

module.exports = {
  createOrder,
  verifyPayment,
  verifyWebhook,
  refundPayment,
  setProviderAdapter,
};
