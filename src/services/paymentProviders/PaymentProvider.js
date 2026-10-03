class PaymentProvider {
  createOrder() {
    throw new Error("PaymentProvider.createOrder must be implemented");
  }

  verifyPayment() {
    throw new Error("PaymentProvider.verifyPayment must be implemented");
  }

  verifyWebhook() {
    throw new Error("PaymentProvider.verifyWebhook must be implemented");
  }

  refundPayment() {
    throw new Error("PaymentProvider.refundPayment must be implemented");
  }
}

module.exports = PaymentProvider;
