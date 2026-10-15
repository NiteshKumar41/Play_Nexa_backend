const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  calculateCommission,
  calculateSettlementFinancials,
  commissionRateForEntry,
} = require("../src/services/commissionService");

describe("commissionService unit calculations (no database)", () => {
  it("covers every commission boundary and the below-₹10 rule", () => {
    const cases = [
      [0.01, 0],
      [9.99, 0],
      [10, 1.5],
      [20, 1.5],
      [20.01, 2],
      [21, 2],
      [29, 2],
      [29.01, 2],
      [30, 2],
      [40, 2],
      [40.01, 3],
      [41, 3],
      [49, 3],
      [49.01, 3],
      [50, 3],
      [60, 3],
      [60.01, 4],
      [61, 4],
      [69, 4],
      [69.01, 4],
      [70, 4],
      [80, 4],
      [80.01, 5],
      [81, 5],
      [89, 5],
      [89.01, 5],
      [90, 5],
      [100, 5],
      [100.01, 4],
      [101, 4],
      [500, 4],
    ];

    for (const [entryAmount, expectedRate] of cases) {
      assert.equal(commissionRateForEntry(entryAmount), expectedRate, String(entryAmount));
    }
  });

  it("calculates commission on gross winning amount and rounds to cents", () => {
    assert.deepEqual(calculateCommission({ entryAmount: 50, grossWinningAmount: 101 }), {
      entryAmount: 50,
      grossWinningAmount: 101,
      commissionRate: 3,
      commissionAmount: 3.03,
    });
  });

  it("applies referral reward only above ₹100 and funds it from the gross payout", () => {
    assert.equal(
      calculateSettlementFinancials({
        entryAmount: 50,
        grossWinningAmount: 100,
        hasEligibleReferrer: true,
      }).referralReward,
      0
    );

    const oneHundredOne = calculateSettlementFinancials({
      entryAmount: 50,
      grossWinningAmount: 101,
      hasEligibleReferrer: true,
    });
    assert.equal(oneHundredOne.referralReward, 2.02);
    assert.equal(oneHundredOne.winnerNetPayout, 95.95);

    const oneFifty = calculateSettlementFinancials({
      entryAmount: 100,
      grossWinningAmount: 150,
      hasEligibleReferrer: true,
    });
    assert.equal(oneFifty.referralReward, 3);
    assert.equal(oneFifty.winnerNetPayout, 139.5);

    const noReferrer = calculateSettlementFinancials({
      entryAmount: 100,
      grossWinningAmount: 500,
      hasEligibleReferrer: false,
    });
    assert.equal(noReferrer.referralReward, 0);
    assert.equal(noReferrer.winnerNetPayout, 475);
  });
});
