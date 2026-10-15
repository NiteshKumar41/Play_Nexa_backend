const assert = require("node:assert/strict");
const { afterEach, describe, it } = require("node:test");

const User = require("../src/models/User");
const Game = require("../src/models/Game");
const GameMatch = require("../src/models/GameMatch");
const WalletTransaction = require("../src/models/WalletTransaction");
const PlatformCommission = require("../src/models/PlatformCommission");
const SupportTicket = require("../src/models/SupportTicket");
const dashboardService = require("../src/services/dashboardService");

const models = [
  User,
  Game,
  GameMatch,
  WalletTransaction,
  PlatformCommission,
  SupportTicket,
];
const originalMethods = new Map();

afterEach(() => {
  for (const [model, methods] of originalMethods) {
    Object.assign(model, methods);
  }
  originalMethods.clear();
});

function mockMethod(model, name, implementation) {
  if (!originalMethods.has(model)) originalMethods.set(model, {});
  const methods = originalMethods.get(model);
  if (!(name in methods)) methods[name] = model[name];
  model[name] = implementation;
}

describe("dashboard commission reporting (no database)", () => {
  it("uses PlatformCommission totals and reports legacy fees separately", async () => {
    mockMethod(User, "countDocuments", async filter => {
      if (Object.keys(filter).length === 0) return 11;
      if (filter.active) return 9;
      return 1;
    });
    mockMethod(Game, "countDocuments", async filter =>
      filter.isActive ? 4 : 7
    );
    mockMethod(GameMatch, "countDocuments", async filter =>
      filter.status ? 22 : 30
    );
    mockMethod(WalletTransaction, "countDocuments", async filter =>
      filter.transactionType === "ADD_MONEY" ? 2 : 3
    );
    mockMethod(SupportTicket, "countDocuments", async () => 5);
    mockMethod(WalletTransaction, "aggregate", async () => [
      { _id: "ADD_MONEY", amount: 1000 },
      { _id: "WITHDRAW", amount: 250 },
    ]);
    mockMethod(PlatformCommission, "aggregate", async () => [
      { _id: null, amount: 18.5, count: 3 },
    ]);
    mockMethod(GameMatch, "aggregate", async () => [
      { _id: null, amount: 6, count: 1 },
    ]);

    const summary = await dashboardService.getSummary();

    assert.equal(summary.platformCommissionTotal, 18.5);
    assert.equal(summary.platformCommissionCount, 3);
    assert.equal(summary.legacyPlatformFeeTotal, 6);
    assert.equal(summary.legacySettledMatchCount, 1);
    assert.equal(summary.platformEarnings, 18.5);
  });
});
