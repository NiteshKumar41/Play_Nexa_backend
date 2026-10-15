const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  calculateWinRate,
  mergeRecentActivity,
} = require("../src/services/playerDashboardService");

describe("player dashboard summary helpers (no database)", () => {
  it("calculates a zero-safe, one-decimal win rate", () => {
    assert.equal(calculateWinRate(0, 0), 0);
    assert.equal(calculateWinRate(2, 3), 66.7);
    assert.equal(calculateWinRate(3, 3), 100);
  });

  it("sorts and bounds mixed activity by event time", () => {
    const transactions = Array.from({ length: 6 }, (_, index) => ({
      id: `transaction-${index}`,
      createdAt: `2026-10-01T0${index}:00:00.000Z`,
    }));
    const matches = [{
      id: "match-latest",
      createdAt: "2026-10-01T12:00:00.000Z",
      updatedAt: "2026-10-01T12:00:00.000Z",
    }];

    const result = mergeRecentActivity(transactions, matches);
    assert.equal(result.length, 7);
    assert.equal(result[0].activityId, "match-match-latest");
    assert.equal(result.at(-1).activityId, "transaction-transaction-0");
  });
});
