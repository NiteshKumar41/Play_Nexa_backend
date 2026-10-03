const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const User = require("../src/models/User");
const Wallet = require("../src/models/Wallet");
const WalletTransaction = require("../src/models/WalletTransaction");
const paymentService = require("../src/services/paymentService");
const { createRazorpayDepositOrder } = require("../src/services/razorpayOrderService");

describe("Razorpay order service with mocked persistence and provider", () => {
  it("creates pending orders, scopes idempotency to the user, and leaves wallet balance alone", async () => {
    const originals = {
      userFindById: User.findById,
      walletFindOne: Wallet.findOne,
      transactionFindOne: WalletTransaction.findOne,
      transactionCreate: WalletTransaction.create,
      transactionFindOneAndUpdate: WalletTransaction.findOneAndUpdate,
      transactionFindById: WalletTransaction.findById,
    };
    const wallets = new Map();
    const transactions = [];
    let providerCalls = 0;
    let orderNumber = 0;
    const userId = "64b000000000000000000001";
    const otherUserId = "64b000000000000000000002";
    const walletId = "64b000000000000000000011";
    const otherWalletId = "64b000000000000000000012";
    wallets.set(userId, { _id: walletId, userId, balance: 73 });
    wallets.set(otherUserId, { _id: otherWalletId, userId: otherUserId, balance: 9 });
    User.findById = id => ({ select: async () => ({ _id: id, phone: "9000000001" }) });
    Wallet.findOne = query => ({ select: async () => wallets.get(query.userId) });
    WalletTransaction.findOne = async query => transactions.find(item =>
      item.userId === query.userId && item.transactionType === query.transactionType && item.clientRequestId === query.clientRequestId
    ) || null;
    WalletTransaction.create = async documents => {
      const created = documents.map((document, index) => ({
        ...document,
        _id: `64b0000000000000000000${transactions.length + index + 30}`,
      }));
      transactions.push(...created);
      return created;
    };
    WalletTransaction.findOneAndUpdate = async (filter, update) => {
      const transaction = transactions.find(item => item._id === filter._id);
      Object.assign(transaction, update.$set);
      return transaction;
    };
    WalletTransaction.findById = async id => transactions.find(item => item._id === id) || null;
    paymentService.setProviderAdapter({
      createOrder: async ({ transaction }) => {
        providerCalls += 1;
        orderNumber += 1;
        return { id: `order_mock_${orderNumber}`, amount: Math.round(transaction.amount * 100), currency: "INR", status: "created" };
      },
      verifyPayment: async () => ({}),
      verifyWebhook: async () => true,
      refundPayment: async () => ({}),
    });

    try {
      const body = { amount: 12.5, clientRequestId: "same-id" };
      const first = await createRazorpayDepositOrder(userId, body);
      const retry = await createRazorpayDepositOrder(userId, body);
      const otherUser = await createRazorpayDepositOrder(otherUserId, body);
      const anotherKey = await createRazorpayDepositOrder(userId, { amount: 12.5, clientRequestId: "new-id" });
      assert.equal(first.transactionId, retry.transactionId);
      assert.equal(first.gatewayOrderId, retry.gatewayOrderId);
      assert.notEqual(otherUser.transactionId, first.transactionId);
      assert.notEqual(anotherKey.transactionId, first.transactionId);
      assert.equal(providerCalls, 3);
      assert.deepEqual([...wallets.values()].map(item => item.balance), [73, 9]);
      for (const result of [first, otherUser, anotherKey]) {
        const transaction = transactions.find(item => item._id === result.transactionId);
        assert.equal(transaction.status, "PENDING");
        assert.ok(transaction.gatewayOrderId);
        assert.equal(transaction.transactionType, "ADD_MONEY");
      }
      await assert.rejects(
        createRazorpayDepositOrder(userId, { ...body, userId: otherUserId }),
        error => error.statusCode === 400
      );
    } finally {
      User.findById = originals.userFindById;
      Wallet.findOne = originals.walletFindOne;
      WalletTransaction.findOne = originals.transactionFindOne;
      WalletTransaction.create = originals.transactionCreate;
      WalletTransaction.findOneAndUpdate = originals.transactionFindOneAndUpdate;
      WalletTransaction.findById = originals.transactionFindById;
      paymentService.setProviderAdapter(null);
    }
  });
});
