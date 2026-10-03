const { afterEach, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const Wallet = require("../src/models/Wallet");
const WalletTransaction = require("../src/models/WalletTransaction");
const paymentService = require("../src/services/paymentService");
const RazorpayProvider = require("../src/services/paymentProviders/RazorpayProvider");
const walletRoutes = require("../src/routes/walletRoutes");
const { verifyRazorpayDeposit } = require("../src/services/depositService");

const USER_ID = "64b000000000000000000001";
const WALLET_ID = "64b000000000000000000002";
const TRANSACTION_ID = "64b000000000000000000003";
const ORDER_ID = "order_mock_payment";
const PAYMENT_ID = "pay_mock_payment";
const KEY_SECRET = "mock_razorpay_key_secret";

let restoreFixture;

function signature(orderId = ORDER_ID, paymentId = PAYMENT_ID) {
  return crypto.createHmac("sha256", KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
}

function makeFixture({
  transactionStatus = "PENDING",
  payment = {},
  failLedgerUpdate = false,
} = {}) {
  const wallet = { _id: WALLET_ID, userId: USER_ID, balance: 30 };
  const deposit = {
    _id: TRANSACTION_ID,
    userId: USER_ID,
    walletId: WALLET_ID,
    transactionType: "ADD_MONEY",
    amount: 24,
    balanceBefore: 30,
    balanceAfter: 30,
    status: transactionStatus,
    gatewayOrderId: ORDER_ID,
    gatewayStatus: transactionStatus === "SUCCESS" ? "captured" : "created",
    ...(transactionStatus === "SUCCESS" ? { gatewayPaymentId: PAYMENT_ID } : {}),
  };
  const db = { wallet, deposit, ledgerEntries: [deposit], sessionCalls: 0, providerFetches: 0 };
  const originals = {
    walletFindOne: Wallet.findOne,
    walletFindOneAndUpdate: Wallet.findOneAndUpdate,
    transactionFindOne: WalletTransaction.findOne,
    transactionFindOneAndUpdate: WalletTransaction.findOneAndUpdate,
    startSession: mongoose.startSession,
  };

  mongoose.startSession = async () => {
    db.sessionCalls += 1;
    return {
      withTransaction: async callback => {
        const walletSnapshot = wallet.balance;
        const depositSnapshot = { ...deposit };
        try {
          return await callback();
        } catch (error) {
          wallet.balance = walletSnapshot;
          Object.assign(deposit, depositSnapshot);
          throw error;
        }
      },
      endSession: async () => {},
    };
  };

  WalletTransaction.findOne = filter => {
    const found = filter.gatewayOrderId
      ? (filter.gatewayOrderId === deposit.gatewayOrderId && filter.userId === deposit.userId ? deposit : null)
      : (String(filter._id) === String(deposit._id) && filter.userId === deposit.userId ? deposit : null);
    return {
      session: async () => found,
      then: (resolve, reject) => Promise.resolve(found).then(resolve, reject),
    };
  };
  Wallet.findOne = filter => {
    const found = filter._id === wallet._id && filter.userId === USER_ID ? wallet : null;
    return {
      session: async () => found,
      then: (resolve, reject) => Promise.resolve(found).then(resolve, reject),
    };
  };
  Wallet.findOneAndUpdate = async (filter, update, options) => {
    assert.ok(options.session, "wallet update must participate in the MongoDB transaction");
    if (wallet._id !== filter._id || wallet.balance !== filter.balance) return null;
    wallet.balance = update.$set.balance;
    return wallet;
  };
  WalletTransaction.findOneAndUpdate = async (filter, update, options) => {
    assert.ok(options.session, "ledger update must participate in the MongoDB transaction");
    if (failLedgerUpdate) return null;
    if (deposit._id !== filter._id || deposit.status !== filter.status) return null;
    Object.assign(deposit, update.$set);
    return deposit;
  };

  paymentService.setProviderAdapter(new RazorpayProvider({
    keyId: "mock_key_id",
    keySecret: KEY_SECRET,
    fetchPayment: async id => {
      db.providerFetches += 1;
      return {
        id,
        order_id: ORDER_ID,
        amount: 2400,
        currency: "INR",
        status: "captured",
        ...payment,
      };
    },
  }));

  restoreFixture = () => {
    Wallet.findOne = originals.walletFindOne;
    Wallet.findOneAndUpdate = originals.walletFindOneAndUpdate;
    WalletTransaction.findOne = originals.transactionFindOne;
    WalletTransaction.findOneAndUpdate = originals.transactionFindOneAndUpdate;
    mongoose.startSession = originals.startSession;
    paymentService.setProviderAdapter(null);
  };
  return { db, deposit, wallet };
}

function validPaymentData(overrides = {}) {
  return {
    razorpay_order_id: ORDER_ID,
    razorpay_payment_id: PAYMENT_ID,
    razorpay_signature: signature(),
    ...overrides,
  };
}

afterEach(() => {
  restoreFixture?.();
  restoreFixture = null;
});

describe("Razorpay ADD_MONEY payment verification", () => {
  it("exposes an authenticated payment verification endpoint", () => {
    assert.equal(walletRoutes.stack[0].name, "authMiddleware");
    assert.ok(walletRoutes.stack.some(layer =>
      layer.route?.path === "/deposits/verify" && layer.route.methods.post
    ));
  });

  it("verifies the signature and atomically credits and updates the existing ledger entry", async () => {
    const { db, deposit, wallet } = makeFixture();
    const result = await verifyRazorpayDeposit(USER_ID, validPaymentData());
    assert.equal(result.status, "SUCCESS");
    assert.equal(wallet.balance, 54);
    assert.equal(deposit.status, "SUCCESS");
    assert.equal(deposit.gatewayPaymentId, PAYMENT_ID);
    assert.equal(deposit.gatewayStatus, "captured");
    assert.equal(db.ledgerEntries.length, 1);
    assert.equal(db.ledgerEntries[0], deposit);
    assert.equal(db.sessionCalls, 1);
  });

  it("rejects an invalid signature without crediting the wallet", async () => {
    const { db, deposit, wallet } = makeFixture();
    await assert.rejects(
      verifyRazorpayDeposit(USER_ID, validPaymentData({ razorpay_signature: "invalid" })),
      error => error.statusCode === 400
    );
    assert.equal(wallet.balance, 30);
    assert.equal(deposit.status, "PENDING");
    assert.equal(db.sessionCalls, 0);
  });

  it("rejects a payment that belongs to a different order", async () => {
    const { db, deposit, wallet } = makeFixture({ payment: { order_id: "order_wrong" } });
    await assert.rejects(verifyRazorpayDeposit(USER_ID, validPaymentData()), error => error.statusCode === 400);
    assert.equal(wallet.balance, 30);
    assert.equal(deposit.status, "PENDING");
    assert.equal(db.sessionCalls, 0);
  });

  it("rejects an amount mismatch", async () => {
    const { db, deposit, wallet } = makeFixture({ payment: { amount: 2399 } });
    await assert.rejects(verifyRazorpayDeposit(USER_ID, validPaymentData()), error => error.statusCode === 400);
    assert.equal(wallet.balance, 30);
    assert.equal(deposit.status, "PENDING");
    assert.equal(db.sessionCalls, 0);
  });

  it("rejects a non-INR payment", async () => {
    const { db, deposit, wallet } = makeFixture({ payment: { currency: "USD" } });
    await assert.rejects(verifyRazorpayDeposit(USER_ID, validPaymentData()), error => error.statusCode === 400);
    assert.equal(wallet.balance, 30);
    assert.equal(deposit.status, "PENDING");
    assert.equal(db.sessionCalls, 0);
  });

  it("returns an already successful transaction without checking or crediting again", async () => {
    const { db, deposit, wallet } = makeFixture({ transactionStatus: "SUCCESS" });
    const result = await verifyRazorpayDeposit(USER_ID, validPaymentData({ razorpay_signature: "not-rechecked" }));
    assert.equal(result.status, "SUCCESS");
    assert.equal(wallet.balance, 30);
    assert.equal(deposit.status, "SUCCESS");
    assert.equal(db.providerFetches, 0);
    assert.equal(db.sessionCalls, 0);
  });

  it("makes duplicate verification idempotent and credits exactly once", async () => {
    const { db, deposit, wallet } = makeFixture();
    const first = await verifyRazorpayDeposit(USER_ID, validPaymentData());
    const second = await verifyRazorpayDeposit(USER_ID, validPaymentData());
    assert.equal(first.transactionId, second.transactionId);
    assert.equal(wallet.balance, 54);
    assert.equal(db.ledgerEntries.length, 1);
    assert.equal(db.sessionCalls, 1);
    assert.equal(db.providerFetches, 1);
    assert.equal(deposit.status, "SUCCESS");
  });

  it("rolls back the wallet change if updating the ledger fails", async () => {
    const { db, deposit, wallet } = makeFixture({ failLedgerUpdate: true });
    await assert.rejects(verifyRazorpayDeposit(USER_ID, validPaymentData()), error => error.statusCode === 409);
    assert.equal(wallet.balance, 30);
    assert.equal(deposit.status, "PENDING");
    assert.equal(deposit.gatewayPaymentId, undefined);
    assert.equal(db.ledgerEntries.length, 1);
    assert.equal(db.sessionCalls, 1);
  });
});
