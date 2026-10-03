const crypto = require("crypto");
const PaymentProvider = require("./PaymentProvider");

function rupeesToPaise(amount) {
  const text = typeof amount === "number" ? String(amount) : amount;
  if (typeof text !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(text)) {
    throw new TypeError("Amount must be a positive rupee amount with at most 2 decimal places");
  }
  const [rupees, fraction = ""] = text.split(".");
  const paise = BigInt(rupees) * 100n + BigInt(fraction.padEnd(2, "0") || "0");
  if (paise <= 0n || paise > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("Amount is outside the safe Razorpay amount range");
  }
  return Number(paise);
}

class RazorpayProvider extends PaymentProvider {
  constructor({ keyId = process.env.RAZORPAY_KEY_ID, keySecret = process.env.RAZORPAY_KEY_SECRET, fetchPayment, fetchOrder } = {}) {
    super();
    this.keyId = keyId;
    this.keySecret = keySecret;
    this.fetchPayment = fetchPayment || this.fetchPaymentFromRazorpay.bind(this);
    this.fetchOrder = fetchOrder || this.createOrderAtRazorpay.bind(this);
  }

  async createOrder({ transaction, idempotencyKey }) {
    if (!this.keyId || !this.keySecret) {
      const error = new Error("Razorpay credentials are not configured");
      error.statusCode = 503;
      throw error;
    }
    return this.fetchOrder({
      amount: rupeesToPaise(transaction.amount),
      currency: "INR",
      receipt: String(idempotencyKey || transaction._id),
    });
  }

  async createOrderAtRazorpay(orderData) {
    const credentials = Buffer.from(`${this.keyId}:${this.keySecret}`).toString("base64");
    const response = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/json" },
      body: JSON.stringify(orderData),
    });
    if (!response.ok) {
      const error = new Error("Unable to create Razorpay order");
      error.statusCode = 502;
      throw error;
    }
    return response.json();
  }
  async verifyWebhook({ headers, rawBody }) {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) {
      const error = new Error("Razorpay webhook secret is not configured");
      error.statusCode = 503;
      throw error;
    }
    const suppliedSignature = headers?.["x-razorpay-signature"];
    if (typeof suppliedSignature !== "string" || !Buffer.isBuffer(rawBody)) return false;
    const expected = Buffer.from(crypto.createHmac("sha256", secret).update(rawBody).digest("hex"));
    const supplied = Buffer.from(suppliedSignature);
    return expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);
  }
  async refundPayment() { throw new Error("Razorpay refunds are not implemented in this checkpoint"); }

  async fetchPaymentFromRazorpay(paymentId) {
    if (!this.keyId || !this.keySecret) {
      const error = new Error("Razorpay credentials are not configured");
      error.statusCode = 503;
      throw error;
    }
    const credentials = Buffer.from(`${this.keyId}:${this.keySecret}`).toString("base64");
    const response = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Basic ${credentials}` },
    });
    if (!response.ok) {
      const error = new Error("Unable to retrieve Razorpay payment");
      error.statusCode = 502;
      throw error;
    }
    return response.json();
  }

  async verifyPayment({ transaction, paymentData }) {
    const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = paymentData;
    if (!this.keySecret) {
      const error = new Error("Razorpay credentials are not configured");
      error.statusCode = 503;
      throw error;
    }
    const expectedSignature = crypto.createHmac("sha256", this.keySecret)
      .update(`${orderId}|${paymentId}`).digest("hex");
    const expected = Buffer.from(expectedSignature);
    const supplied = Buffer.from(typeof signature === "string" ? signature : "");
    const signatureValid = expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);
    if (!signatureValid) return { signatureValid: false };
    const payment = await this.fetchPayment(paymentId);
    return {
      signatureValid: true,
      orderId: payment.order_id,
      paymentId: payment.id,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
    };
  }
}

module.exports = RazorpayProvider;
module.exports.rupeesToPaise = rupeesToPaise;
