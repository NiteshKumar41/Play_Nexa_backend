const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { normalizeProfileUpdate } = require("../src/services/userService");

describe("profile update validation (no database)", () => {
  it("allows only supported profile fields and normalizes editable values", () => {
    const update = normalizeProfileUpdate({
      fullName: "  Updated Player  ",
      email: "  USER@Example.COM ",
      dob: "2000-01-02",
      gender: " Other ",
      upiId: "player@bank",
    });

    assert.deepEqual(update, {
      $set: {
        fullName: "Updated Player",
        email: "user@example.com",
        dob: "2000-01-02",
        gender: "Other",
        upiId: "player@bank",
      },
    });
  });

  it("rejects protected fields and invalid profile values", () => {
    for (const details of [
      { role: "admin" },
      { referredBy: "507f1f77bcf86cd799439011" },
      { referralCode: "PLAYER123" },
      { fullName: "" },
      { email: "not-an-email" },
      { dob: "2026-02-30" },
      { upiId: "not-an-upi" },
      {},
    ]) {
      assert.throws(() => normalizeProfileUpdate(details), { statusCode: 400 });
    }
  });
});
