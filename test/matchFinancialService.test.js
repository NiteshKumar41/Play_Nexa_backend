const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { calculateMatchFinancials } = require("../src/services/matchFinancialService");

describe("pre-settlement match financials (no database)", () => {
  it("exposes a qualified estimate instead of treating it as a final payout", () => {
    const financials = calculateMatchFinancials(100, 100);

    assert.equal(financials.estimatedWinnerPayout, 190);
    assert.equal(financials.winnerNetPayout, 190);
    assert.equal(financials.platformCommission, 10);
  });
});
