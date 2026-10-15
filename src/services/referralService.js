const crypto = require("crypto");
const mongoose = require("mongoose");
const User = require("../models/User");

const REFERRAL_CODE_PATTERN = /^[A-Z0-9]{8,32}$/;
const REFERRAL_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_CODE_ATTEMPTS = 8;

function referralError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeReferralCode(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw referralError("Referral code must be text");
  }

  const normalized = value.trim().toUpperCase();
  if (!normalized || !REFERRAL_CODE_PATTERN.test(normalized)) {
    throw referralError("Referral code is invalid");
  }
  return normalized;
}

function createReferralCode() {
  const bytes = crypto.randomBytes(10);
  let code = "";
  for (let index = 0; index < 10; index += 1) {
    code += REFERRAL_CODE_ALPHABET[bytes[index] % REFERRAL_CODE_ALPHABET.length];
  }
  return code;
}

async function generateUniqueReferralCode(session) {
  if (!session) throw referralError("A MongoDB session is required", 500);

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
    const referralCode = createReferralCode();
    const existing = await User.findOne({ referralCode })
      .select("_id")
      .session(session);
    if (!existing) return referralCode;
  }

  throw referralError("Unable to generate a unique referral code", 503);
}

function assertNotSelfReferral(referrerId, referredUserId) {
  if (
    referrerId &&
    referredUserId &&
    referrerId.toString() === referredUserId.toString()
  ) {
    throw referralError("You cannot use your own referral code");
  }
}

async function ensureReferralCode(userId) {
  if (!mongoose.isValidObjectId(userId)) {
    throw referralError("Invalid user", 400);
  }

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
    const currentUser = await User.findById(userId).select("_id referralCode");
    if (!currentUser) throw referralError("User account not found", 404);
    if (currentUser.referralCode) return currentUser;

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const userWithoutCode = await User.findOne({
          _id: userId,
          $or: [{ referralCode: null }, { referralCode: { $exists: false } }],
        }).session(session);
        if (!userWithoutCode) return;

        const referralCode = await generateUniqueReferralCode(session);
        await User.updateOne(
          { _id: userId, $or: [{ referralCode: null }, { referralCode: { $exists: false } }] },
          { $set: { referralCode } },
          { session, runValidators: true }
        );
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
    } finally {
      await session.endSession();
    }
  }

  throw referralError("Unable to assign a referral code", 503);
}

module.exports = {
  normalizeReferralCode,
  generateUniqueReferralCode,
  assertNotSelfReferral,
  ensureReferralCode,
};
