const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  REQUIRED_INDEXES,
  indexMatches,
  parseArguments,
} = require("../scripts/settlementIndexMigration");

describe("settlement index readiness tool (no database)", () => {
  it("requires an explicit verify or apply mode", () => {
    assert.deepEqual(parseArguments(["--verify"]), {
      apply: false,
      allowProduction: false,
      databaseName: null,
    });
    assert.throws(() => parseArguments([]), /exactly one/i);
    assert.throws(() => parseArguments(["--verify", "--apply"]), /exactly one/i);
  });

  it("defines the unique referral and commission protections", () => {
    const names = REQUIRED_INDEXES.map(index => index.name);
    assert.deepEqual(names, [
      "user_referralCode_unique",
      "referredBy_1",
      "walletTransaction_referralReward_match_unique",
      "matchId_1",
      "settlementReference_1",
    ]);
    assert.equal(
      indexMatches(
        {
          key: { matchId: 1 },
          unique: true,
        },
        REQUIRED_INDEXES.find(index => index.name === "matchId_1")
      ),
      true
    );
    assert.equal(
      indexMatches(
        {
          key: { matchId: 1 },
          unique: false,
        },
        REQUIRED_INDEXES.find(index => index.name === "matchId_1")
      ),
      false
    );
  });
});
