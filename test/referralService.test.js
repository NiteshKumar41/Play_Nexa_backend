const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const User = require("../src/models/User");
const {
  assertNotSelfReferral,
  normalizeReferralCode,
} = require("../src/services/referralService");

describe("referralService unit validation (no database)", () => {
  it("normalizes valid referral codes and rejects malformed input", () => {
    assert.equal(normalizeReferralCode(" abcd2345 "), "ABCD2345");
    assert.equal(normalizeReferralCode(""), null);
    assert.throws(() => normalizeReferralCode("short"), /invalid/i);
    assert.throws(() => normalizeReferralCode("invalid-code"), /invalid/i);
  });

  it("rejects self-referral and leaves the relationship immutable in the schema", () => {
    assert.throws(() => assertNotSelfReferral("507f1f77bcf86cd799439011", "507f1f77bcf86cd799439011"), /own referral/i);
    assert.equal(User.schema.path("referredBy").options.immutable, true);
    const referralIndex = User.schema.indexes().find(([, options]) => options?.name === "user_referralCode_unique");
    assert.ok(referralIndex);
    assert.equal(referralIndex[1].unique, true);
    assert.equal(referralIndex[1].sparse, true);
  });
});
