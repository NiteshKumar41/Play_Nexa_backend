const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const RazorpayProvider = require("../src/services/paymentProviders/RazorpayProvider");

describe("Razorpay amount conversion", () => {
  it("converts rupees to paise without floating-point arithmetic", () => {
    assert.equal(RazorpayProvider.rupeesToPaise("24.00"), 2400);
    assert.equal(RazorpayProvider.rupeesToPaise("0.01"), 1);
    assert.throws(() => RazorpayProvider.rupeesToPaise("24.001"), /at most 2 decimal places/);
  });
});

describe("RazorpayProvider payment verification", () => {
  const paymentData = {
    razorpay_order_id: "order_mock_test",
    razorpay_payment_id: "pay_mock_test",
  };
  const signature = secret => crypto.createHmac("sha256", secret)
    .update(`${paymentData.razorpay_order_id}|${paymentData.razorpay_payment_id}`)
    .digest("hex");

  it("accepts a valid signature and returns mocked payment details", async () => {
    let lookupId;
    const provider = new RazorpayProvider({
      keyId: "test_key_id",
      keySecret: "test_only_secret",
      fetchPayment: async id => {
        lookupId = id;
        return { id, order_id: paymentData.razorpay_order_id, amount: 2400, currency: "INR", status: "captured" };
      },
    });
    const result = await provider.verifyPayment({
      transaction: { gatewayOrderId: paymentData.razorpay_order_id, amount: 24 },
      paymentData: { ...paymentData, razorpay_signature: signature("test_only_secret") },
    });
    assert.equal(lookupId, paymentData.razorpay_payment_id);
    assert.deepEqual(result, { signatureValid: true, orderId: paymentData.razorpay_order_id, paymentId: paymentData.razorpay_payment_id, amount: 2400, currency: "INR", status: "captured" });
  });

  it("rejects an invalid signature without looking up a payment", async () => {
    let lookedUp = false;
    const provider = new RazorpayProvider({ keySecret: "test_only_secret", fetchPayment: async () => { lookedUp = true; } });
    const result = await provider.verifyPayment({
      transaction: { gatewayOrderId: paymentData.razorpay_order_id, amount: 24 },
      paymentData: { ...paymentData, razorpay_signature: "invalid" },
    });
    assert.deepEqual(result, { signatureValid: false });
    assert.equal(lookedUp, false);
  });

  it("verifies webhook signatures against the exact raw body", async () => {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    process.env.RAZORPAY_WEBHOOK_SECRET = "webhook_test_only_secret";
    try {
      const provider = new RazorpayProvider();
      const rawBody = Buffer.from('{"event":"payment.captured","spacing": true}');
      const signature = crypto.createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest("hex");
      assert.equal(await provider.verifyWebhook({ headers: { "x-razorpay-signature": signature }, rawBody }), true);
      assert.equal(await provider.verifyWebhook({ headers: { "x-razorpay-signature": signature }, rawBody: Buffer.from('{"event":"payment.captured","spacing":true}') }), false);
    } finally {
      if (secret === undefined) delete process.env.RAZORPAY_WEBHOOK_SECRET;
      else process.env.RAZORPAY_WEBHOOK_SECRET = secret;
    }
  });
});
