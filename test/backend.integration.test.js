const {
  after,
  before,
  beforeEach,
  describe,
  it,
} = require("node:test");
const assert = require("node:assert/strict");

const TEST_DATABASE_URI = process.env.MONGODB_URI_TEST;
const testDatabaseName = TEST_DATABASE_URI
  ? new URL(TEST_DATABASE_URI).pathname.slice(1).split("?")[0]
  : "";

if (!TEST_DATABASE_URI || !/test/i.test(testDatabaseName)) {
  describe("Backend integration tests", { skip: true }, () => {
    it("requires MONGODB_URI_TEST pointing to a test-only database", () => {});
  });
} else {
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET ||= "play-nexa-automated-test-secret-32-characters-minimum";
  process.env.JWT_EXPIRES_IN ||= "30d";
  process.env.CLIENT_URL ||= "http://localhost:5173";

  const http = require("node:http");
  const bcrypt = require("bcryptjs");
  const mongoose = require("mongoose");
  const { Server } = require("socket.io");
  const { io: createSocketClient } = require("socket.io-client");
  const app = require("../src/app");
  const initializeSocket = require("../src/socket");
  const { setSocketServer } = require("../src/socket/socketManager");
  const {
    apiRateLimiter,
    authenticationRateLimiter,
    financialWriteRateLimiter,
  } = require("../src/middleware/securityMiddleware");
  const { generateToken } = require("../src/utils/jwt");
  const { calculateMatchFinancials } = require("../src/services/matchFinancialService");
  const fileStorage = require("../src/utils/fileStorage");
  const User = require("../src/models/User");
  const Wallet = require("../src/models/Wallet");
  const WalletTransaction = require("../src/models/WalletTransaction");
  const PaymentEvent = require("../src/models/PaymentEvent");
  const Game = require("../src/models/Game");
  const GameMatch = require("../src/models/GameMatch");
  const PaymentMethod = require("../src/models/PaymentMethod");
  const SupportTicket = require("../src/models/SupportTicket");

  const pngBytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l0sAAAAASUVORK5CYII=",
    "base64"
  );
  let server;
  let socketServer;
  let baseUrl;
  let admin;
  let players;
  let tokens;
  let game;
  let activePaymentMethod;
  const uploadedFiles = {
    deposit: [],
    result: [],
    support: [],
    game: [],
    payment: [],
  };

  function makeForm(fields, fileField, fileName = "../../client-name.png") {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      form.set(key, String(value));
    }
    if (fileField) {
      form.set(
        fileField,
        new Blob([pngBytes], { type: "image/png" }),
        fileName
      );
    }
    return form;
  }

  async function api(path, { token, method = "GET", body, form } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(form ? { body: form } : {}),
    });
    const isJson = response.headers
      .get("content-type")
      ?.includes("application/json");
    return {
      response,
      data: isJson ? await response.json() : null,
    };
  }

  async function createPlayer(fullName, phone) {
    const result = await api("/api/v1/auth/signup", {
      method: "POST",
      body: { fullName, phone, password: "123456" },
    });
    assert.equal(result.response.status, 201, JSON.stringify(result.data));
    return result.data.data;
  }

  async function createMatch(playerIndex, entryFee = 50) {
    const result = await api("/api/v1/matches", {
      token: tokens[playerIndex],
      method: "POST",
      body: { gameId: game._id.toString(), entryFee },
    });
    return result;
  }

  async function joinMatch(playerIndex, matchId) {
    return api(`/api/v1/matches/${matchId}/join`, {
      token: tokens[playerIndex],
      method: "POST",
      body: {},
    });
  }

  async function createDeposit(playerIndex, amount, utr) {
    const result = await api("/api/v1/wallet/deposits", {
      token: tokens[playerIndex],
      method: "POST",
      form: makeForm({ amount, upiTransactionId: utr }, "proof"),
    });
    if (result.data?.data?.proofUrl) {
      uploadedFiles.deposit.push(result.data.data.proofUrl.split("/").at(-1));
    }
    return result;
  }

  describe("Play Nexa backend critical flows", () => {
    beforeEach(() => {
      apiRateLimiter.resetKey("::ffff:127.0.0.1");
      apiRateLimiter.resetKey("127.0.0.1");
      financialWriteRateLimiter.resetKey("::ffff:127.0.0.1");
      financialWriteRateLimiter.resetKey("127.0.0.1");
      authenticationRateLimiter.resetKey("::ffff:127.0.0.1");
      authenticationRateLimiter.resetKey("127.0.0.1");
    });

    before(async () => {
      process.env.MONGODB_URI = TEST_DATABASE_URI;
      await mongoose.connect(TEST_DATABASE_URI);
      await mongoose.connection.dropDatabase();

      server = http.createServer(app);
      socketServer = new Server(server, {
        cors: { origin: process.env.CLIENT_URL },
      });
      setSocketServer(socketServer);
      initializeSocket(socketServer);
      await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
      baseUrl = `http://127.0.0.1:${server.address().port}`;

      const password = await bcrypt.hash("123456", 10);
      admin = await User.create({
        fullName: "Integration Admin",
        phone: "9000000700",
        password,
        role: "admin",
      });
      players = await User.create([
        {
          fullName: "Integration Player One",
          phone: "9000000701",
          password,
        },
        {
          fullName: "Integration Player Two",
          phone: "9000000702",
          password,
        },
        {
          fullName: "Integration Player Three",
          phone: "9000000703",
          password,
        },
      ]);
      const walletService = require("../src/services/walletService");
      await Promise.all(players.map(player => walletService.createWallet(player._id)));
      tokens = [
        generateToken(players[0]),
        generateToken(players[1]),
        generateToken(players[2]),
        generateToken(admin),
      ];
      await PaymentMethod.create({
        upiId: "playnexa@example",
        payeeName: "Play Nexa",
        status: true,
        createdBy: admin._id,
        updatedBy: admin._id,
      });
      activePaymentMethod = await PaymentMethod.findOne({ status: true });
      game = await Game.create({
        gameCode: 14001,
        name: "Integration Ludo",
        isActive: true,
        isOpen: true,
        createdBy: admin._id,
      });
    });

    after(async () => {
      await Promise.all(
        Object.entries(uploadedFiles).flatMap(([kind, files]) =>
          files.map(async fileName => {
            const deleteFile = {
              deposit: fileStorage.deleteDepositProof,
              result: fileStorage.deleteFile,
              support: fileStorage.deleteSupportImage,
              game: fileStorage.deleteGameImage,
              payment: fileStorage.deletePaymentMethodQr,
            }[kind];
            await deleteFile(fileName);
          })
        )
      );
      if (socketServer) await new Promise(resolve => socketServer.close(resolve));
      if (server?.listening) await new Promise(resolve => server.close(resolve));
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    });

    it("serves the documented health endpoint and standard security headers", async () => {
      const { response, data } = await api("/health");
      assert.equal(response.status, 200);
      assert.deepEqual(data, {
        success: true,
        message: "Play Nexa backend is healthy",
      });
      assert.ok(response.headers.get("x-content-type-options"));
      assert.ok(response.headers.get("x-frame-options"));
      assert.ok(response.headers.get("x-request-id"));
      assert.equal(response.headers.get("x-powered-by"), null);
    });

    it("creates, lists, updates, and rejects duplicate games", async () => {
      const created = await api("/api/v1/admin/games", {
        token: tokens[3],
        method: "POST",
        body: {
          gameCode: 14002,
          name: "Integration Chess",
          status: false,
          isOpen: false,
        },
      });
      assert.equal(created.response.status, 201);
      const gameId = created.data.data.game.id;
      assert.equal(created.data.data.game.isActive, false);

      const duplicateCode = await api("/api/v1/admin/games", {
        token: tokens[3],
        method: "POST",
        body: {
          gameCode: 14002,
          name: "Another Integration Game",
        },
      });
      assert.equal(duplicateCode.response.status, 409);
      const duplicateName = await api("/api/v1/admin/games", {
        token: tokens[3],
        method: "POST",
        body: { gameCode: 14003, name: "Integration Chess" },
      });
      assert.equal(duplicateName.response.status, 409);

      const listed = await api("/api/v1/admin/games?page=1&limit=1", {
        token: tokens[3],
      });
      assert.equal(listed.response.status, 200);
      assert.equal(listed.data.data.pagination.limit, 1);
      const updated = await api(`/api/v1/admin/games/${gameId}`, {
        token: tokens[3],
        method: "PATCH",
        body: { status: true, isOpen: true },
      });
      assert.equal(updated.response.status, 200);
      assert.equal(updated.data.data.game.isActive, true);
      assert.equal(updated.data.data.game.isOpen, true);
    });

    it("validates signup, hashes passcodes, creates wallets, and returns safe user data", async () => {
      const invalidRequests = [
        { fullName: "Invalid Phone", phone: "123", password: "123456" },
        { fullName: "Invalid Email", phone: "9000000711", password: "123456", email: "invalid" },
        { fullName: "Invalid DOB", phone: "9000000712", password: "123456", dob: "2026-02-30" },
        { fullName: "Invalid Passcode", phone: "9000000713", password: "bad" },
        { fullName: "Future DOB", phone: "9000000714", password: "123456", dob: "2999-01-01" },
      ];
      for (const body of invalidRequests) {
        const result = await api("/api/v1/auth/signup", {
          method: "POST",
          body,
        });
        assert.equal(result.response.status, 400);
        assert.equal(result.data.success, false);
      }

      const created = await api("/api/v1/auth/signup", {
        method: "POST",
        body: {
          fullName: "Valid Signup",
          phone: "9000000710",
          password: "123456",
          email: "valid@example.test",
          dob: "2000-01-01",
        },
      });
      assert.equal(created.response.status, 201);
      assert.ok(created.data.data.token);
      assert.equal(
        (await Wallet.findOne({ userId: created.data.data.user.id })).balance,
        0
      );

      const duplicate = await api("/api/v1/auth/signup", {
        method: "POST",
        body: {
          fullName: "Duplicate",
          phone: players[0].phone,
          password: "123456",
        },
      });
      assert.equal(duplicate.response.status, 409);

      const stored = await User.findById(players[0]._id).select("+password");
      assert.notEqual(stored.password, "123456");
      assert.ok(await bcrypt.compare("123456", stored.password));
      const me = await api("/api/v1/auth/me", { token: tokens[0] });
      assert.equal(me.response.status, 200);
      assert.equal(me.data.data.user.id, players[0]._id.toString());
      for (const secretField of ["password", "passwordHash", "salt", "token"]) {
        assert.equal(Object.hasOwn(me.data.data.user, secretField), false);
      }
      const wallet = await api("/api/v1/wallet", { token: tokens[0] });
      assert.equal(wallet.response.status, 200);
      assert.equal(wallet.data.data.balance, 0);
      const walletHistory = await api("/api/v1/wallet/transactions", {
        token: tokens[0],
      });
      assert.equal(walletHistory.response.status, 200);
      assert.equal(walletHistory.data.data.pagination.total, 0);
    });

    it("authenticates logins and rejects invalid, blocked, and inactive accounts", async () => {
      const validLogin = await api("/api/v1/auth/login", {
        method: "POST",
        body: { phone: players[0].phone, password: "123456" },
      });
      assert.equal(validLogin.response.status, 200);
      assert.ok(validLogin.data.data.token);
      const wrongPassword = await api("/api/v1/auth/login", {
        method: "POST",
        body: { phone: players[0].phone, password: "654321" },
      });
      const wrongPhone = await api("/api/v1/auth/login", {
        method: "POST",
        body: { phone: "9000000799", password: "123456" },
      });
      assert.equal(wrongPassword.response.status, 401);
      assert.equal(wrongPhone.response.status, 401);
      assert.equal(wrongPassword.data.message, wrongPhone.data.message);

      const expiredToken = require("jsonwebtoken").sign(
        { id: players[0]._id.toString() },
        process.env.JWT_SECRET,
        { expiresIn: -1 }
      );
      assert.equal(
        (await api("/api/v1/auth/me", { token: expiredToken })).response.status,
        401
      );
      assert.equal((await api("/api/v1/auth/me")).response.status, 401);
      assert.equal(
        (
          await api("/api/v1/admin/dashboard/summary", {
            token: tokens[0],
          })
        ).response.status,
        403
      );
      await User.updateOne({ _id: players[2]._id }, { $set: { active: false } });
      assert.equal(
        (await api("/api/v1/auth/me", { token: tokens[2] })).response.status,
        403
      );
      await User.updateOne({ _id: players[2]._id }, { $set: { active: true } });
      await User.updateOne(
        { _id: players[2]._id },
        { $set: { isBlocked: true } }
      );
      assert.equal(
        (
          await api("/api/v1/auth/login", {
            method: "POST",
            body: { phone: players[2].phone, password: "123456" },
          })
        ).response.status,
        401
      );
      await User.updateOne(
        { _id: players[2]._id },
        { $set: { isBlocked: false } }
      );
    });

    it("processes deposit approval/rejection exactly once and protects player ownership", async () => {
      const initialWallet = await Wallet.findOne({ userId: players[0]._id });
      const pendingDeposit = await createDeposit(0, 500, "TEST-DEPOSIT-APPROVE");
      assert.equal(pendingDeposit.response.status, 201);
      assert.equal(pendingDeposit.data.data.status, "PENDING");
      assert.equal((await Wallet.findById(initialWallet._id)).balance, 0);

      const anotherPending = await createDeposit(0, 50, "TEST-DEPOSIT-REJECT");
      assert.equal(anotherPending.response.status, 201);
      const ownerProof = new URL(
        pendingDeposit.data.data.proofUrl,
        baseUrl
      );
      const proofPath = ownerProof.pathname;
      const ownProof = await api(proofPath, { token: tokens[0] });
      assert.equal(ownProof.response.status, 200);
      const otherProof = await api(proofPath, { token: tokens[1] });
      assert.ok([403, 404].includes(otherProof.response.status));

      const adminPending = await api(
        "/api/v1/admin/deposits/pending?page=1&limit=1",
        { token: tokens[3] }
      );
      assert.equal(adminPending.response.status, 200);
      assert.equal(adminPending.data.data.pagination.limit, 1);

      const approvePath = `/api/v1/admin/deposits/${pendingDeposit.data.data.transactionId}/approve`;
      const approved = await api(approvePath, {
        token: tokens[3],
        method: "POST",
        body: {},
      });
      assert.equal(approved.response.status, 200);
      assert.equal((await Wallet.findById(initialWallet._id)).balance, 500);
      assert.equal(
        (
          await api(approvePath, {
            token: tokens[3],
            method: "POST",
            body: {},
          })
        ).response.status,
        409
      );

      const rejectPath = `/api/v1/admin/deposits/${anotherPending.data.data.transactionId}/reject`;
      const rejected = await api(rejectPath, {
        token: tokens[3],
        method: "POST",
        body: { reason: "Submitted proof did not match the payment." },
      });
      assert.equal(rejected.response.status, 200);
      assert.equal((await Wallet.findById(initialWallet._id)).balance, 500);
      assert.equal(
        (
          await api(rejectPath, {
            token: tokens[3],
            method: "POST",
            body: { reason: "Repeated rejection attempt." },
          })
        ).response.status,
        409
      );

      const unauthorizedApproval = await api(
        `/api/v1/admin/deposits/${pendingDeposit.data.data.transactionId}/approve`,
        { token: tokens[1], method: "POST", body: {} }
      );
      assert.equal(unauthorizedApproval.response.status, 403);
      const transaction = await WalletTransaction.findById(
        pendingDeposit.data.data.transactionId
      ).lean();
      assert.equal(transaction.balanceAfter, transaction.balanceBefore + transaction.amount);
      assert.equal(transaction.status, "SUCCESS");
    });

    it("creates authenticated Razorpay orders idempotently without changing wallets", async () => {
      const paymentService = require("../src/services/paymentService");
      const wallet = await Wallet.findOne({ userId: players[0]._id });
      const startingBalance = wallet.balance;
      let orderSequence = 0;
      let providerCalls = 0;
      paymentService.setProviderAdapter({
        createOrder: async ({ transaction }) => {
          providerCalls += 1;
          orderSequence += 1;
          return { id: `order_api_mock_${orderSequence}`, amount: Math.round(transaction.amount * 100), currency: "INR", status: "created" };
        },
        verifyPayment: async () => ({}),
        verifyWebhook: async () => true,
        refundPayment: async () => ({}),
      });
      try {
        const unauthenticated = await api("/api/v1/payments/razorpay/order", {
          method: "POST", body: { amount: 40, clientRequestId: "order-api-auth" },
        });
        assert.equal(unauthenticated.response.status, 401);

        const body = { amount: 40, clientRequestId: "order-api-same" };
        const first = await api("/api/v1/payments/razorpay/order", { token: tokens[0], method: "POST", body });
        assert.equal(first.response.status, 201, JSON.stringify(first.data));
        const retry = await api("/api/v1/payments/razorpay/order", { token: tokens[0], method: "POST", body });
        assert.equal(retry.response.status, 201);
        assert.equal(retry.data.data.transactionId, first.data.data.transactionId);
        assert.equal(retry.data.data.gatewayOrderId, first.data.data.gatewayOrderId);
        assert.equal(providerCalls, 1);

        const different = await api("/api/v1/payments/razorpay/order", {
          token: tokens[0], method: "POST", body: { amount: 40, clientRequestId: "order-api-different" },
        });
        assert.equal(different.response.status, 201);
        assert.notEqual(different.data.data.transactionId, first.data.data.transactionId);
        assert.notEqual(different.data.data.gatewayOrderId, first.data.data.gatewayOrderId);

        const bodyIdentity = await api("/api/v1/payments/razorpay/order", {
          token: tokens[0], method: "POST", body: { amount: 40, clientRequestId: "order-api-body-user", userId: players[1]._id.toString(), walletId: "ignored" },
        });
        assert.equal(bodyIdentity.response.status, 400);
        assert.equal(await WalletTransaction.countDocuments({ clientRequestId: "order-api-body-user" }), 0);
        assert.equal((await Wallet.findById(wallet._id)).balance, startingBalance);
        for (const transactionId of [first.data.data.transactionId, different.data.data.transactionId]) {
          const transaction = await WalletTransaction.findById(transactionId);
          assert.equal(transaction.userId.toString(), players[0]._id.toString());
          assert.equal(transaction.status, "PENDING");
          assert.ok(transaction.gatewayOrderId);
        }
      } finally {
        paymentService.setProviderAdapter(null);
      }
    });

    it("verifies mocked Razorpay payments and credits an ADD_MONEY deposit once", async () => {
      const paymentService = require("../src/services/paymentService");
      const wallet = await Wallet.findOne({ userId: players[0]._id });
      const deposit = await WalletTransaction.create({
        userId: players[0]._id,
        walletId: wallet._id,
        transactionType: "ADD_MONEY",
        amount: 125,
        balanceBefore: 0,
        balanceAfter: 0,
        status: "PENDING",
        gatewayOrderId: "order_mock_18",
      });
      let mocked = { signatureValid: true, orderId: "order_mock_18", paymentId: "pay_mock_18", amount: 12500, currency: "INR", status: "captured" };
      paymentService.setProviderAdapter({
        createOrder: async () => ({}),
        verifyPayment: async () => mocked,
        verifyWebhook: async () => ({}),
        refundPayment: async () => ({}),
      });
      const body = { razorpay_order_id: "order_mock_18", razorpay_payment_id: "pay_mock_18", razorpay_signature: "mock_signature" };
      const verify = () => api("/api/v1/wallet/deposits/verify", { token: tokens[0], method: "POST", body });

      mocked = { ...mocked, signatureValid: false };
      assert.equal((await verify()).response.status, 400);
      assert.equal((await Wallet.findById(wallet._id)).balance, 0);
      assert.equal((await WalletTransaction.findById(deposit._id)).status, "PENDING");

      mocked = { ...mocked, signatureValid: true, orderId: "order_other" };
      assert.equal((await verify()).response.status, 400);
      mocked = { ...mocked, orderId: "order_mock_18", amount: 12499 };
      assert.equal((await verify()).response.status, 400);
      mocked = { ...mocked, amount: 12500, currency: "USD" };
      assert.equal((await verify()).response.status, 400);
      assert.equal((await Wallet.findById(wallet._id)).balance, 0);

      mocked = { ...mocked, currency: "INR" };
      const first = await verify();
      assert.equal(first.response.status, 200, JSON.stringify(first.data));
      assert.equal((await Wallet.findById(wallet._id)).balance, 125);
      const second = await verify();
      assert.equal(second.response.status, 200);
      assert.equal((await Wallet.findById(wallet._id)).balance, 125);
      const saved = await WalletTransaction.findById(deposit._id);
      assert.equal(saved.status, "SUCCESS");
      assert.equal(saved.gatewayPaymentId, "pay_mock_18");
      assert.equal(saved.gatewayStatus, "captured");
      assert.equal(await WalletTransaction.countDocuments({ _id: deposit._id, transactionType: "ADD_MONEY", status: "SUCCESS" }), 1);
      paymentService.setProviderAdapter(null);
    });

    it("deduplicates signed Razorpay webhooks and rolls back wallet and event writes atomically", async () => {
      const crypto = require("node:crypto");
      const previousSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
      process.env.RAZORPAY_WEBHOOK_SECRET = "integration_webhook_secret_only";
      const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
      const wallet = await Wallet.findOne({ userId: players[0]._id });
      const startingBalance = wallet.balance;
      let suffix = 0;
      async function makeDeposit(amount = 80) {
        suffix += 1;
        return WalletTransaction.create({
          userId: players[0]._id, walletId: wallet._id, transactionType: "ADD_MONEY",
          amount, balanceBefore: startingBalance, balanceAfter: startingBalance,
          status: "PENDING", gatewayOrderId: `order_hook_${suffix}`,
        });
      }
      async function sendWebhook(eventId, orderId, amount, currency = "INR", signatureOverride) {
        const rawBody = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: {
          id: `pay_${eventId}`, order_id: orderId, amount, currency, status: "captured",
        } } } });
        const signature = signatureOverride || crypto.createHmac("sha256", secret).update(Buffer.from(rawBody)).digest("hex");
        const response = await fetch(`${baseUrl}/api/v1/webhooks/razorpay`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-razorpay-signature": signature, "x-razorpay-event-id": eventId },
          body: rawBody,
        });
        return { response, data: await response.json() };
      }
      try {
        const deposit = await makeDeposit();
        const invalid = await sendWebhook("evt_bad_sig", deposit.gatewayOrderId, 8000, "INR", "bad_signature");
        assert.equal(invalid.response.status, 400);
        assert.equal(await PaymentEvent.countDocuments({ eventId: "evt_bad_sig" }), 0);
        assert.equal((await Wallet.findById(wallet._id)).balance, startingBalance);

        const applied = await sendWebhook("evt_valid", deposit.gatewayOrderId, 8000);
        assert.equal(applied.response.status, 200, JSON.stringify(applied.data));
        const duplicate = await sendWebhook("evt_valid", deposit.gatewayOrderId, 8000);
        assert.equal(duplicate.response.status, 200);
        assert.equal(duplicate.data.data.duplicate, true);
        assert.equal((await Wallet.findById(wallet._id)).balance, startingBalance + 80);
        assert.equal(await PaymentEvent.countDocuments({ provider: "RAZORPAY", eventId: "evt_valid" }), 1);
        assert.equal(await WalletTransaction.countDocuments({ _id: deposit._id, status: "SUCCESS" }), 1);

        const mismatch = await makeDeposit(30);
        await sendWebhook("evt_amount_bad", mismatch.gatewayOrderId, 2999);
        await sendWebhook("evt_currency_bad", mismatch.gatewayOrderId, 3000, "USD");
        const unknown = await sendWebhook("evt_unknown", "order_unknown", 1000);
        assert.equal(unknown.response.status, 200);
        assert.equal((await Wallet.findById(wallet._id)).balance, startingBalance + 80);
        assert.equal((await WalletTransaction.findById(mismatch._id)).status, "PENDING");

        const verified = await makeDeposit(20);
        await WalletTransaction.updateOne({ _id: verified._id }, { $set: { status: "SUCCESS" } });
        const alreadyVerified = await sendWebhook("evt_after_verify", verified.gatewayOrderId, 2000);
        assert.equal(alreadyVerified.response.status, 200);
        assert.equal((await Wallet.findById(wallet._id)).balance, startingBalance + 80);
        assert.equal(await PaymentEvent.countDocuments({ eventId: "evt_after_verify", status: "IGNORED" }), 1);

        const rollback = await makeDeposit(15);
        const originalUpdate = Wallet.findOneAndUpdate;
        Wallet.findOneAndUpdate = async () => { throw new Error("simulated wallet persistence failure"); };
        try {
          const rolledBack = await sendWebhook("evt_rollback", rollback.gatewayOrderId, 1500);
          assert.equal(rolledBack.response.status, 500);
        } finally {
          Wallet.findOneAndUpdate = originalUpdate;
        }
        assert.equal((await Wallet.findById(wallet._id)).balance, startingBalance + 80);
        assert.equal((await WalletTransaction.findById(rollback._id)).status, "PENDING");
        assert.equal(await PaymentEvent.countDocuments({ eventId: "evt_rollback" }), 0);
      } finally {
        if (previousSecret === undefined) delete process.env.RAZORPAY_WEBHOOK_SECRET;
        else process.env.RAZORPAY_WEBHOOK_SECRET = previousSecret;
      }
    });

    it("reserves withdrawals atomically and refunds rejected withdrawals once", async () => {
      const wallet = await Wallet.findOne({ userId: players[0]._id });
      const successful = await api("/api/v1/wallet/withdrawals", {
        token: tokens[0],
        method: "POST",
        body: {
          amount: 100,
          upiId: "player@example",
          clientRequestId: "test-withdrawal-success",
        },
      });
      assert.equal(successful.response.status, 201);
      assert.equal((await Wallet.findById(wallet._id)).balance, 400);
      const withdrawal = await WalletTransaction.findById(
        successful.data.data.transactionId
      ).lean();
      assert.equal(withdrawal.userId.toString(), players[0]._id.toString());
      assert.equal(withdrawal.transactionType, "WITHDRAW");
      assert.equal(withdrawal.status, "INITIATED");
      assert.equal(withdrawal.balanceAfter, withdrawal.balanceBefore - withdrawal.amount);
      assert.equal(
        await WalletTransaction.countDocuments({
          userId: players[0]._id,
          transactionType: "WITHDRAW",
          clientRequestId: "test-withdrawal-success",
        }),
        1
      );

      const markedSuccess = await api(
        `/api/v1/admin/withdrawals/${withdrawal._id}/success`,
        {
          token: tokens[3],
          method: "POST",
          body: { upiTransactionId: "PAYOUT-SUCCESS-1" },
        }
      );
      assert.equal(markedSuccess.response.status, 200);
      assert.equal((await Wallet.findById(wallet._id)).balance, 400);
      assert.equal(
        (
          await api(`/api/v1/admin/withdrawals/${withdrawal._id}/success`, {
            token: tokens[3],
            method: "POST",
            body: { upiTransactionId: "PAYOUT-SUCCESS-2" },
          })
        ).response.status,
        409
      );

      const rejectedWithdrawal = await api("/api/v1/wallet/withdrawals", {
        token: tokens[0],
        method: "POST",
        body: {
          amount: 50,
          upiId: "player@example",
          clientRequestId: "test-withdrawal-rejected",
        },
      });
      assert.equal(rejectedWithdrawal.response.status, 201);
      assert.equal((await Wallet.findById(wallet._id)).balance, 350);
      const rejectUrl = `/api/v1/admin/withdrawals/${rejectedWithdrawal.data.data.transactionId}/reject`;
      const refund = await api(rejectUrl, {
        token: tokens[3],
        method: "POST",
        body: { reason: "Destination account could not be verified." },
      });
      assert.equal(refund.response.status, 200);
      assert.equal((await Wallet.findById(wallet._id)).balance, 400);
      const reversal = await WalletTransaction.findOne({
        transactionType: "WITHDRAW_REFUND",
        referenceType: "WITHDRAWAL",
        referenceId: rejectedWithdrawal.data.data.transactionId,
      }).lean();
      assert.ok(reversal);
      assert.equal(reversal.amount, 50);
      assert.equal(reversal.balanceBefore, 350);
      assert.equal(reversal.balanceAfter, 400);
      assert.equal(reversal.status, "SUCCESS");
      const originalWithdrawal = await WalletTransaction.findById(
        rejectedWithdrawal.data.data.transactionId
      ).lean();
      assert.equal(originalWithdrawal.transactionType, "WITHDRAW");
      assert.equal(originalWithdrawal.status, "FAILED");
      assert.equal(originalWithdrawal.balanceBefore, 400);
      assert.equal(originalWithdrawal.balanceAfter, 350);
      assert.equal(
        (
          await api(rejectUrl, {
            token: tokens[3],
            method: "POST",
            body: { reason: "Repeated rejection request." },
          })
        ).response.status,
        409
      );
      assert.equal((await Wallet.findById(wallet._id)).balance, 400);
      assert.equal(
        await WalletTransaction.countDocuments({
          transactionType: "WITHDRAW_REFUND",
          referenceType: "WITHDRAWAL",
          referenceId: rejectedWithdrawal.data.data.transactionId,
        }),
        1
      );

      const insufficient = await api("/api/v1/wallet/withdrawals", {
        token: tokens[0],
        method: "POST",
        body: { amount: 401, upiId: "player@example" },
      });
      assert.ok([400, 422].includes(insufficient.response.status));
      assert.equal((await Wallet.findById(wallet._id)).balance, 400);
      assert.equal(
        await WalletTransaction.countDocuments({
          userId: players[0]._id,
          transactionType: "WITHDRAW",
          amount: 401,
        }),
        0
      );
    });

    it("creates and joins matches atomically and enforces creator and participant rules", async () => {
      const creatorWallet = await Wallet.findOne({ userId: players[0]._id });
      const joinerWallet = await Wallet.findOne({ userId: players[1]._id });
      const thirdPlayerWallet = await Wallet.findOne({ userId: players[2]._id });
      await Wallet.updateOne({ _id: creatorWallet._id }, { $set: { balance: 500 } });
      await Wallet.updateOne({ _id: joinerWallet._id }, { $set: { balance: 500 } });
      await Wallet.updateOne({ _id: thirdPlayerWallet._id }, { $set: { balance: 500 } });
      const beforeCreateBalance = (await Wallet.findById(creatorWallet._id)).balance;
      const matchResponse = await createMatch(0);
      assert.equal(matchResponse.response.status, 201);
      const matchId = matchResponse.data.data.match.id;
      assert.equal((await Wallet.findById(creatorWallet._id)).balance, beforeCreateBalance - 50);
      assert.equal(
        await WalletTransaction.countDocuments({
          userId: players[0]._id,
          transactionType: "GAME_CREATE",
          referenceId: matchId,
        }),
        1
      );
      assert.equal(matchResponse.data.data.match.status, "ACTIVE");

      const insufficientPlayer = await Wallet.findOne({ userId: players[2]._id });
      await Wallet.updateOne({ _id: insufficientPlayer._id }, { $set: { balance: 20 } });
      const insufficientCreate = await createMatch(2);
      assert.equal(insufficientCreate.response.status, 422);
      assert.equal((await Wallet.findById(insufficientPlayer._id)).balance, 20);
      assert.equal(
        await GameMatch.countDocuments({ player1: players[2]._id }),
        0
      );
      await Wallet.updateOne(
        { _id: insufficientPlayer._id },
        { $set: { balance: 500 } }
      );

      const selfJoin = await joinMatch(0, matchId);
      assert.equal(selfJoin.response.status, 400);
      assert.equal((await Wallet.findById(creatorWallet._id)).balance, beforeCreateBalance - 50);

      const joinAttempt = await joinMatch(1, matchId);
      assert.equal(joinAttempt.response.status, 200);
      assert.equal(joinAttempt.data.data.match.status, "JOINED");
      assert.ok(joinAttempt.data.data.match.joinedAt);
      assert.equal((await Wallet.findById(joinerWallet._id)).balance, 450);
      const simultaneousJoinMatch = await createMatch(0);
      assert.equal(simultaneousJoinMatch.response.status, 201);
      const simultaneousId = simultaneousJoinMatch.data.data.match.id;
      const simultaneousJoins = await Promise.all([
        joinMatch(1, simultaneousId),
        joinMatch(2, simultaneousId),
      ]);
      assert.equal(simultaneousJoins.filter(result => result.response.status === 200).length, 1);
      assert.equal(simultaneousJoins.filter(result => result.response.status === 409 || result.response.status === 422).length, 1);
      assert.equal(
        await WalletTransaction.countDocuments({
          transactionType: "GAME_JOIN",
          referenceId: simultaneousId,
        }),
        1
      );

      const roomCode = await api(`/api/v1/matches/${matchId}/room-code`, {
        token: tokens[0],
        method: "PATCH",
        body: { roomCode: "987654" },
      });
      assert.equal(roomCode.response.status, 200);
      const playerTwoDetails = await api(`/api/v1/matches/${matchId}`, {
        token: tokens[1],
      });
      assert.equal(playerTwoDetails.data.data.match.roomCode, "987654");
      assert.equal(
        (
          await api(`/api/v1/matches/${matchId}/room-code`, {
            token: tokens[1],
            method: "PATCH",
            body: { roomCode: "PLAYER2-CHANGE" },
          })
        ).response.status,
        403
      );
      assert.equal(
        (
          await api(`/api/v1/matches/${matchId}/room-code`, {
            token: tokens[2],
            method: "PATCH",
            body: { roomCode: "OUTSIDER-CHANGE" },
          })
        ).response.status,
        403
      );
      const outsiderDetails = await api(`/api/v1/matches/${matchId}`, {
        token: tokens[2],
      });
      assert.equal(outsiderDetails.response.status, 403);
      assert.equal(
        (await joinMatch(2, matchId)).response.status,
        409
      );
      assert.equal(
        (
          await api(`/api/v1/matches/${matchId}/leave`, {
            token: tokens[1],
            method: "POST",
            body: {},
          })
        ).response.status,
        400
      );
      const balanceAfterFailedLeave = (await Wallet.findById(joinerWallet._id)).balance;

      const leaveMatch = await createMatch(0);
      const leaveMatchId = leaveMatch.data.data.match.id;
      const beforeJoinLeaveBalance = (await Wallet.findById(joinerWallet._id)).balance;
      assert.equal((await joinMatch(1, leaveMatchId)).response.status, 200);
      const leaveResponse = await api(`/api/v1/matches/${leaveMatchId}/leave`, {
        token: tokens[1],
        method: "POST",
        body: {},
      });
      assert.equal(leaveResponse.response.status, 200);
      assert.equal(leaveResponse.data.data.match.status, "ACTIVE");
      assert.equal(leaveResponse.data.data.match.player2, null);
      assert.equal((await Wallet.findById(joinerWallet._id)).balance, beforeJoinLeaveBalance);
      assert.equal(beforeJoinLeaveBalance, balanceAfterFailedLeave);

      const cancelMatch = await createMatch(0);
      const cancelId = cancelMatch.data.data.match.id;
      const cancel = await api(`/api/v1/matches/${cancelId}/cancel`, {
        token: tokens[0],
        method: "POST",
        body: {},
      });
      assert.equal(cancel.response.status, 200);
      assert.equal(cancel.data.data.match.status, "CANCELLED");
      const joinedMatch = await createMatch(0);
      assert.equal((await joinMatch(1, joinedMatch.data.data.match.id)).response.status, 200);
      const cancelAfterJoin = await api(
        `/api/v1/matches/${joinedMatch.data.data.match.id}/cancel`,
        {
        token: tokens[0],
        method: "POST",
        body: {},
        }
      );
      assert.equal(cancelAfterJoin.response.status, 400);
    });

    it("enforces stored match join deadlines before wallet debit and preserves legacy and concurrent joins", async () => {
      const creatorWallet = await Wallet.findOne({ userId: players[0]._id });
      const joinerWallet = await Wallet.findOne({ userId: players[1]._id });
      const thirdPlayerWallet = await Wallet.findOne({ userId: players[2]._id });
      for (const wallet of [creatorWallet, joinerWallet, thirdPlayerWallet]) {
        await Wallet.updateOne({ _id: wallet._id }, { $set: { balance: 500 } });
      }

      const beforeDeadlineMatch = await createMatch(0);
      const beforeDeadlineId = beforeDeadlineMatch.data.data.match.id;
      await GameMatch.updateOne(
        { _id: beforeDeadlineId },
        { $set: { joinDeadline: new Date(Date.now() + 60_000) } }
      );
      const beforeJoin = await joinMatch(1, beforeDeadlineId);
      assert.equal(beforeJoin.response.status, 200);

      for (const deadline of [new Date(Date.now() - 1), new Date()]) {
        const expiredMatch = await createMatch(0);
        const expiredId = expiredMatch.data.data.match.id;
        await GameMatch.updateOne({ _id: expiredId }, { $set: { joinDeadline: deadline } });
        const balanceBeforeJoin = (await Wallet.findById(joinerWallet._id)).balance;
        const expiredJoin = await joinMatch(1, expiredId);
        assert.equal(expiredJoin.response.status, 409);
        assert.equal(expiredJoin.data.message, "Match joining deadline has passed");
        assert.equal((await Wallet.findById(joinerWallet._id)).balance, balanceBeforeJoin);
        assert.equal(
          await WalletTransaction.countDocuments({
            userId: players[1]._id,
            transactionType: "GAME_JOIN",
            referenceId: expiredId,
          }),
          0
        );
        assert.equal((await GameMatch.findById(expiredId)).player2, null);
      }

      const legacyMatch = await createMatch(0);
      const legacyId = legacyMatch.data.data.match.id;
      await GameMatch.updateOne({ _id: legacyId }, { $unset: { joinDeadline: 1 } });
      assert.equal((await joinMatch(1, legacyId)).response.status, 200);

      const concurrentMatch = await createMatch(0);
      const concurrentId = concurrentMatch.data.data.match.id;
      const concurrentResults = await Promise.all([
        joinMatch(1, concurrentId),
        joinMatch(2, concurrentId),
      ]);
      assert.equal(concurrentResults.filter(result => result.response.status === 200).length, 1);
      assert.equal(
        await WalletTransaction.countDocuments({
          transactionType: "GAME_JOIN",
          referenceId: concurrentId,
        }),
        1
      );
    });

    it("submits claims/disputes and atomically settles disputed matches once", async () => {
      await Wallet.updateOne(
        { userId: players[0]._id },
        { $set: { balance: 500 } }
      );
      await Wallet.updateOne(
        { userId: players[1]._id },
        { $set: { balance: 500 } }
      );
      const match = await createMatch(0);
      const matchId = match.data.data.match.id;
      assert.equal((await joinMatch(1, matchId)).response.status, 200);

      const outsiderClaim = await api(`/api/v1/matches/${matchId}/result`, {
        token: tokens[2],
        method: "POST",
        form: makeForm({ winnerClaim: "true" }, "screenshot"),
      });
      assert.equal(outsiderClaim.response.status, 403);

      const claim = await api(`/api/v1/matches/${matchId}/result`, {
        token: tokens[0],
        method: "POST",
        form: makeForm(
          { winnerClaim: "true", remarks: "Winner screenshot" },
          "screenshot"
        ),
      });
      assert.equal(claim.response.status, 200);
      assert.equal(claim.data.data.match.status, "COMPLETED");
      assert.equal(claim.data.data.match.winnerClaimStatus, "PENDING");
      const matchAfterClaim = await GameMatch.findById(matchId).lean();
      uploadedFiles.result.push(
        new URL(matchAfterClaim.p1Screenshot, "http://local").pathname.split("/").at(-1)
      );

      const outsiderResult = await api(`/api/v1/matches/${matchId}/result`, {
        token: tokens[2],
      });
      assert.equal(outsiderResult.response.status, 403);
      const dispute = await api(`/api/v1/matches/${matchId}/dispute`, {
        token: tokens[1],
        method: "POST",
        form: makeForm(
          { reason: "The submitted result is disputed." },
          "screenshot"
        ),
      });
      assert.equal(dispute.response.status, 200);
      assert.equal(dispute.data.data.match.status, "DISPUTED");
      assert.equal(
        dispute.data.data.match.disputeClaimedBy,
        players[1]._id.toString()
      );
      const disputedMatch = await GameMatch.findById(matchId).lean();
      uploadedFiles.result.push(
        new URL(disputedMatch.p2Screenshot, "http://local").pathname.split("/").at(-1)
      );
      const pendingResults = await api(
        "/api/v1/matches/admin/results?page=1&limit=1",
        { token: tokens[3] }
      );
      assert.equal(pendingResults.response.status, 200);
      assert.equal(pendingResults.data.data.pagination.limit, 1);

      const adminDetails = await api(`/api/v1/admin/matches/${matchId}`, {
        token: tokens[3],
      });
      assert.equal(adminDetails.response.status, 200);
      assert.ok(adminDetails.data.data.match.player1.name);
      assert.ok(adminDetails.data.data.match.player2.name);
      assert.equal(adminDetails.data.data.match.p1Screenshot, disputedMatch.p1Screenshot);
      assert.equal(adminDetails.data.data.match.p2Screenshot, disputedMatch.p2Screenshot);

      const winnerWallet = await Wallet.findOne({ userId: players[1]._id });
      const beforePayout = winnerWallet.balance;
      const settleUrl = `/api/v1/admin/matches/${matchId}/declare-winner`;
      const settlePayload = { winnerPlayerId: players[1]._id.toString() };
      const settleResults = await Promise.all([
        api(settleUrl, { token: tokens[3], method: "POST", body: settlePayload }),
        api(settleUrl, { token: tokens[3], method: "POST", body: settlePayload }),
      ]);
      assert.equal(settleResults.filter(result => result.response.status === 200).length, 1);
      assert.equal(settleResults.filter(result => result.response.status === 409).length, 1);
      assert.equal((await Wallet.findById(winnerWallet._id)).balance, beforePayout + 80);
      assert.equal(
        await WalletTransaction.countDocuments({
          transactionType: "GAME_WIN",
          referenceType: "MATCH_SETTLEMENT",
          referenceId: matchId,
          status: "SUCCESS",
        }),
        1
      );
      const settled = await GameMatch.findById(matchId).lean();
      assert.equal(settled.status, "SETTLED");
      assert.equal(settled.platformFee, 20);
      assert.equal(settled.winnerAmount, 80);
      assert.equal(settled.settlementWalletTransactionIds.length, 1);
      const dashboardSummary = await api(
        "/api/v1/admin/dashboard/summary",
        { token: tokens[3] }
      );
      assert.equal(dashboardSummary.response.status, 200);
      assert.equal(dashboardSummary.data.data.platformEarnings, 20);

      const refundMatch = await createMatch(0);
      const refundMatchId = refundMatch.data.data.match.id;
      assert.equal((await joinMatch(1, refundMatchId)).response.status, 200);
      const refundClaim = await api(`/api/v1/matches/${refundMatchId}/result`, {
        token: tokens[0],
        method: "POST",
        form: makeForm({ winnerClaim: "true" }, "screenshot"),
      });
      assert.equal(refundClaim.response.status, 200);
      const matchWithRefundEvidence = await GameMatch.findById(refundMatchId).lean();
      uploadedFiles.result.push(
        new URL(
          matchWithRefundEvidence.p1Screenshot,
          "http://local"
        ).pathname.split("/").at(-1)
      );
      const player1Wallet = await Wallet.findOne({ userId: players[0]._id });
      const player2Wallet = await Wallet.findOne({ userId: players[1]._id });
      const balancesBeforeRefund = [
        (await Wallet.findById(player1Wallet._id)).balance,
        (await Wallet.findById(player2Wallet._id)).balance,
      ];
      const refundUrl = `/api/v1/admin/matches/${refundMatchId}/refund`;
      const refund = await api(refundUrl, {
        token: tokens[3],
        method: "POST",
        body: {},
      });
      assert.equal(refund.response.status, 200);
      assert.equal((await Wallet.findById(player1Wallet._id)).balance, balancesBeforeRefund[0] + 50);
      assert.equal((await Wallet.findById(player2Wallet._id)).balance, balancesBeforeRefund[1] + 50);
      assert.equal(
        (
          await api(refundUrl, { token: tokens[3], method: "POST", body: {} })
        ).response.status,
        409
      );
      assert.equal((await GameMatch.findById(refundMatchId)).status, "CANCELLED");
    });

    it("keeps payment method activation unique and protects the last active admin", async () => {
      const playerDetails = await api(`/api/v1/admin/users/${players[2]._id}`, {
        token: tokens[3],
      });
      assert.equal(playerDetails.response.status, 200);
      assert.equal(playerDetails.data.data.user.userType, "player");
      assert.equal(Object.hasOwn(playerDetails.data.data.user, "password"), false);
      assert.equal(typeof playerDetails.data.data.user.wallet.balance, "number");

      const searchedUsers = await api(
        "/api/v1/admin/users?search=Integration%20Player%20Three&userType=player",
        { token: tokens[3] }
      );
      assert.equal(searchedUsers.response.status, 200);
      assert.ok(
        searchedUsers.data.data.users.some(
          user => user.id === players[2]._id.toString()
        )
      );
      assert.equal(
        (
          await api(`/api/v1/admin/users/${players[2]._id}/status`, {
            token: tokens[3],
            method: "PATCH",
            body: { active: false },
          })
        ).response.status,
        200
      );
      assert.equal(
        (
          await api(`/api/v1/admin/users/${players[2]._id}/status`, {
            token: tokens[3],
            method: "PATCH",
            body: { active: true },
          })
        ).response.status,
        200
      );
      assert.equal(
        (
          await api(`/api/v1/admin/users/${players[2]._id}/block`, {
            token: tokens[3],
            method: "PATCH",
            body: { isBlocked: true },
          })
        ).response.status,
        200
      );
      assert.equal(
        (
          await api(`/api/v1/admin/users/${players[2]._id}/block`, {
            token: tokens[3],
            method: "PATCH",
            body: { isBlocked: false },
          })
        ).response.status,
        200
      );
      assert.equal(
        (
          await api(`/api/v1/admin/users/${players[2]._id}/role`, {
            token: tokens[3],
            method: "PATCH",
            body: { userType: "admin" },
          })
        ).response.status,
        200
      );
      assert.equal(
        (
          await api(`/api/v1/admin/users/${players[2]._id}/role`, {
            token: tokens[3],
            method: "PATCH",
            body: { userType: "player" },
          })
        ).response.status,
        200
      );

      const methodA = await PaymentMethod.create({
        upiId: "method-a@example",
        payeeName: "Method A",
        status: false,
        createdBy: admin._id,
        updatedBy: admin._id,
      });
      const methodB = await PaymentMethod.create({
        upiId: "method-b@example",
        payeeName: "Method B",
        status: false,
        createdBy: admin._id,
        updatedBy: admin._id,
      });
      const activateA = await api(
        `/api/v1/admin/payment-methods/${methodA._id}`,
        { token: tokens[3], method: "PATCH", body: { status: true } }
      );
      const activateB = await api(
        `/api/v1/admin/payment-methods/${methodB._id}`,
        { token: tokens[3], method: "PATCH", body: { status: true } }
      );
      assert.equal(activateA.response.status, 200);
      assert.equal(activateB.response.status, 200);
      assert.equal(await PaymentMethod.countDocuments({ status: true }), 1);
      assert.equal((await PaymentMethod.findById(methodB._id)).status, true);
      assert.equal((await PaymentMethod.findById(activePaymentMethod._id)).status, false);

      const secondAdmin = await User.create({
        fullName: "Second Integration Admin",
        phone: "9000000798",
        password: await bcrypt.hash("test-only-password", 10),
        role: "admin",
      });
      const demoteOne = await api(`/api/v1/admin/users/${secondAdmin._id}/role`, {
        token: tokens[3],
        method: "PATCH",
        body: { userType: "player" },
      });
      assert.equal(demoteOne.response.status, 200);
      const lastAdmin = await api(`/api/v1/admin/users/${admin._id}/role`, {
        token: tokens[3],
        method: "PATCH",
        body: { userType: "player" },
      });
      assert.equal(lastAdmin.response.status, 409);
      assert.equal(
        await User.countDocuments({ role: "admin", active: true, isBlocked: false }),
        1
      );
    });

    it("protects support ownership, serves valid uploads, and enforces list limits", async () => {
      const ticket = await api("/api/v1/support/tickets", {
        token: tokens[0],
        method: "POST",
        form: makeForm(
          { subject: "Wallet question", description: "Please check my wallet transaction." },
          "image"
        ),
      });
      assert.equal(ticket.response.status, 201);
      const ticketId = ticket.data.data.ticketId;
      const ticketDocument = await SupportTicket.findById(ticketId).lean();
      uploadedFiles.support.push(
        new URL(ticketDocument.imageUrl, "http://local").pathname.split("/").at(-1)
      );

      assert.equal(
        (
          await api(`/api/v1/support/tickets/${ticketId}`, {
            token: tokens[0],
          })
        ).response.status,
        200
      );
      assert.equal(
        (
          await api(`/api/v1/support/tickets/${ticketId}`, {
            token: tokens[1],
          })
        ).response.status,
        404
      );
      assert.equal(
        (
          await api(ticketDocument.imageUrl, { token: tokens[1] })
        ).response.status,
        404
      );
      const adminTicketList = await api(
        "/api/v1/admin/support/tickets?page=1&limit=10",
        { token: tokens[3] }
      );
      assert.equal(adminTicketList.response.status, 200);
      const start = await api(
        `/api/v1/admin/support/tickets/${ticketId}/status`,
        { token: tokens[3], method: "PATCH", body: { status: "IN_PROGRESS" } }
      );
      assert.equal(start.response.status, 200);
      const resolve = await api(
        `/api/v1/admin/support/tickets/${ticketId}/resolve`,
        {
          token: tokens[3],
          method: "POST",
          body: { resolution: "The wallet history was checked." },
        }
      );
      assert.equal(resolve.response.status, 200);
      assert.equal(
        (
          await api(`/api/v1/admin/support/tickets/${ticketId}/close`, {
            token: tokens[3],
            method: "POST",
            body: {},
          })
        ).response.status,
        200
      );
      assert.equal(
        (
          await api(`/api/v1/admin/support/tickets/${ticketId}/reopen`, {
            token: tokens[3],
            method: "POST",
            body: {},
          })
        ).response.status,
        200
      );
      assert.equal(
        (
          await api("/api/v1/admin/users?page=0&limit=20", {
            token: tokens[3],
          })
        ).response.status,
        400
      );
      assert.equal(
        (
          await api("/api/v1/admin/users?page=1&limit=101", {
            token: tokens[3],
          })
        ).response.status,
        400
      );
      assert.equal(
        (
          await api("/api/v1/admin/matches/not-an-object-id", {
            token: tokens[3],
          })
        ).response.status,
        400
      );

      const invalidFileForm = new FormData();
      invalidFileForm.set("name", "Rejected Upload");
      invalidFileForm.set("gameCode", "14009");
      invalidFileForm.set(
        "image",
        new Blob(["%PDF-1.7"], { type: "application/pdf" }),
        "../../document.pdf"
      );
      const invalidUpload = await api("/api/v1/admin/games", {
        token: tokens[3],
        method: "POST",
        form: invalidFileForm,
      });
      assert.equal(invalidUpload.response.status, 415);
    });

    it("filters financial totals by IST calendar dates and validates financial tiers", async () => {
      assert.deepEqual(calculateMatchFinancials(50, 50), {
        totalPool: 100,
        feePercentage: 20,
        platformFee: 20,
        winnerAmount: 80,
      });
      assert.deepEqual(calculateMatchFinancials(100, 100), {
        totalPool: 200,
        feePercentage: 3,
        platformFee: 6,
        winnerAmount: 194,
      });

      const wallet = await Wallet.findOne({ userId: players[0]._id });
      const boundaryEntries = [
        { amount: 1, createdAt: new Date("2026-10-03T18:29:59.999Z") },
        { amount: 2, createdAt: new Date("2026-10-03T18:30:00.000Z") },
        { amount: 3, createdAt: new Date("2026-10-04T18:29:59.999Z") },
        { amount: 4, createdAt: new Date("2026-10-04T18:30:00.000Z") },
      ];
      await WalletTransaction.insertMany(
        boundaryEntries.map((entry, index) => ({
          walletId: wallet._id,
          userId: players[0]._id,
          transactionType: "ADD_MONEY",
          amount: entry.amount,
          balanceBefore: 0,
          balanceAfter: 0,
          status: "SUCCESS",
          upiTransactionId: `IST-BOUNDARY-${index}-${Date.now()}`,
          createdAt: entry.createdAt,
          updatedAt: entry.createdAt,
        }))
      );
      const dashboard = await api(
        "/api/v1/admin/dashboard/summary?from=2026-10-04&to=2026-10-04",
        { token: tokens[3] }
      );
      assert.equal(dashboard.response.status, 200);
      assert.equal(dashboard.data.data.totalDeposits, 5);
      assert.equal(typeof dashboard.data.data.platformEarnings, "number");
      const invalidDate = await api(
        "/api/v1/admin/dashboard/summary?from=2026-02-30",
        { token: tokens[3] }
      );
      assert.equal(invalidDate.response.status, 400);
    });

    it("authenticates Socket.IO and delivers room updates only to participants", async () => {
      await Wallet.updateOne(
        { userId: players[0]._id },
        { $set: { balance: 500 } }
      );
      await Wallet.updateOne(
        { userId: players[1]._id },
        { $set: { balance: 500 } }
      );
      const match = await createMatch(0);
      const matchId = match.data.data.match.id;
      assert.equal((await joinMatch(1, matchId)).response.status, 200);
      const unauthenticated = createSocketClient(baseUrl, {
        transports: ["websocket"],
        reconnection: false,
      });
      const rejected = await new Promise(resolve => {
        unauthenticated.once("connect_error", error => resolve(error));
      });
      assert.match(rejected.message, /Authentication token is required/);
      unauthenticated.close();

      const playerSocket = createSocketClient(baseUrl, {
        transports: ["websocket"],
        reconnection: false,
        auth: { token: tokens[1] },
      });
      await new Promise((resolve, reject) => {
        playerSocket.once("connect", resolve);
        playerSocket.once("connect_error", reject);
      });
      const serverSocket = [...socketServer.sockets.sockets.values()].find(
        candidate => candidate.user.id === players[1]._id.toString()
      );
      assert.ok(serverSocket);
      assert.ok(serverSocket.rooms.has(`user:${players[1]._id}`));
      assert.equal(serverSocket.rooms.has("admins"), false);
      assert.equal(serverSocket.rooms.has(`user:${players[0]._id}`), false);

      const roomUpdate = new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Room code event was not received")),
          4000
        );
        playerSocket.once("room_code_updated", payload => {
          clearTimeout(timeout);
          resolve(payload);
        });
      });
      playerSocket.emit("join_match_room", { matchId });
      await new Promise(resolve => setTimeout(resolve, 50));
      const updated = await api(`/api/v1/matches/${matchId}/room-code`, {
        token: tokens[0],
        method: "PATCH",
        body: { roomCode: "SOCKET-ROOM" },
      });
      assert.equal(updated.response.status, 200);
      assert.equal((await roomUpdate).roomCode, "SOCKET-ROOM");
      playerSocket.close();
    });

    it("applies login rate limits and rejects disallowed CORS origins", async () => {
      const originCheck = await fetch(`${baseUrl}/health`, {
        headers: { Origin: "https://untrusted.example" },
      });
      assert.equal(originCheck.status, 403);

      let lastResponse;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        lastResponse = await api("/api/v1/auth/login", {
          method: "POST",
          body: { phone: "9000000799", password: "123456" },
        });
      }
      assert.equal(lastResponse.response.status, 429);
    });
  });
}
