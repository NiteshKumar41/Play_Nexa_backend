const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const User = require("../models/User");
const walletService = require("./walletService");
const {
  assertNotSelfReferral,
  ensureReferralCode,
  generateUniqueReferralCode,
  normalizeReferralCode,
} = require("./referralService");
const { generateToken } = require("../utils/jwt");

const DUMMY_PASSWORD_HASH = bcrypt.hashSync("not-a-real-play-nexa-passcode", 10);
const INVALID_LOGIN_MESSAGE = "Invalid phone number or passcode";

function createAuthError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function validateDateOfBirth(dob) {
  if (dob === undefined || dob === null || dob === "") return;
  if (typeof dob !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
    throw createAuthError("Date of birth must use YYYY-MM-DD format", 400);
  }
  const [year, month, day] = dob.split("-").map(Number);
  const parsedDate = new Date(Date.UTC(year, month - 1, day));
  if (
    parsedDate.getUTCFullYear() !== year ||
    parsedDate.getUTCMonth() !== month - 1 ||
    parsedDate.getUTCDate() !== day ||
    parsedDate.getTime() > Date.now()
  ) {
    throw createAuthError("Date of birth is invalid", 400);
  }
}

function validateSignupDetails({ fullName, phone, password }) {
  if (
    typeof fullName !== "string" ||
    !fullName.trim() ||
    typeof phone !== "string" ||
    typeof password !== "string"
  ) {
    throw createAuthError(
      "Full name, phone number, and password are required",
      400
    );
  }

  if (!/^[6-9]\d{9}$/.test(phone.trim())) {
    throw createAuthError(
      "Phone number must be a valid 10-digit Indian mobile number",
      400
    );
  }

  if (!/^\d{6}$/.test(password)) {
    throw createAuthError("Password must contain exactly 6 digits", 400);
  }
}

function getSafeUser(user) {
  return {
    id: user._id.toString(),
    fullName: user.fullName,
    phone: user.phone,
    role: user.role,
    referralCode: user.referralCode || null,
  };
}

async function registerUser(userData) {
  if (!userData || typeof userData !== "object" || Array.isArray(userData)) {
    throw createAuthError("Invalid signup details", 400);
  }
  const allowedFields = [
    "fullName",
    "phone",
    "password",
    "email",
    "dob",
    "gender",
    "upiId",
    "referralCode",
  ];
  if (Object.keys(userData).some(field => !allowedFields.includes(field))) {
    throw createAuthError("Signup request contains unsupported fields", 400);
  }

  const {
    fullName,
    phone,
    password,
    email,
    dob,
    gender,
    upiId,
    referralCode,
  } = userData;

  validateSignupDetails({ fullName, phone, password });
  validateDateOfBirth(dob);
  const normalizedReferralCode = normalizeReferralCode(referralCode);

  if (email !== undefined && email !== "" && typeof email !== "string") {
    throw createAuthError("Email must be a valid email address", 400);
  }

  const normalizedEmail = typeof email === "string" ? email.trim() : "";
  if (
    normalizedEmail &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
  ) {
    throw createAuthError("Email must be a valid email address", 400);
  }

  const normalizedPhone = phone.trim();
  const hashedPassword = await bcrypt.hash(password, 10);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    let user;
    let token;
    const session = await mongoose.startSession();

    try {
      await session.withTransaction(async () => {
        const existingUser = await User.findOne({ phone: normalizedPhone })
          .session(session);

        if (existingUser) {
          throw createAuthError("Phone number already registered", 409);
        }

        const referrer = normalizedReferralCode
          ? await User.findOne({ referralCode: normalizedReferralCode })
              .select("_id")
              .session(session)
          : null;
        if (normalizedReferralCode && !referrer) {
          throw createAuthError("Referral code is invalid", 400);
        }

        [user] = await User.create(
          [
            {
              fullName: fullName.trim(),
              phone: normalizedPhone,
              password: hashedPassword,
              email: normalizedEmail || undefined,
              dob,
              gender,
              upiId,
              referralCode: await generateUniqueReferralCode(session),
              referredBy: referrer?._id || null,
            },
          ],
          { session }
        );
        assertNotSelfReferral(referrer?._id, user._id);

        await walletService.createWallet(user._id, session);
        token = generateToken(user);
      });

      return {
        user: getSafeUser(user),
        token,
      };
    } catch (error) {
      const referralCodeCollision =
        error.code === 11000 &&
        (error.keyPattern?.referralCode || error.keyValue?.referralCode);
      if (referralCodeCollision) continue;
      if (error.code === 11000) {
        throw createAuthError("Phone number already registered", 409);
      }
      throw error;
    } finally {
      await session.endSession();
    }
  }

  throw createAuthError("Unable to generate a unique referral code", 503);
}

async function loginUser(credentials) {
  if (
    !credentials ||
    typeof credentials !== "object" ||
    Array.isArray(credentials)
  ) {
    throw createAuthError("Invalid login details", 400);
  }

  const { phone, password } = credentials;

  if (typeof phone !== "string" || typeof password !== "string") {
    throw createAuthError("Phone number and password are required", 400);
  }

  if (!/^[6-9]\d{9}$/.test(phone.trim()) || !/^\d{6}$/.test(password)) {
    throw createAuthError(INVALID_LOGIN_MESSAGE, 401);
  }

  const user = await User.findOne({ phone: phone.trim() }).select("+password");

  const isPasswordCorrect = await bcrypt.compare(
    password,
    user?.password || DUMMY_PASSWORD_HASH
  );

  if (!user || !isPasswordCorrect || user.isBlocked || !user.active) {
    throw createAuthError(INVALID_LOGIN_MESSAGE, 401);
  }

  const userWithReferralCode = await ensureReferralCode(user._id);
  return {
    user: getSafeUser(userWithReferralCode),
    token: generateToken(userWithReferralCode),
  };
}

async function getCurrentUser(userId) {
  const user = await User.findById(userId);

  if (!user) {
    throw createAuthError("User account not found", 404);
  }

  const userWithReferralCode = await ensureReferralCode(user._id);
  return getSafeUser(userWithReferralCode);
}

module.exports = {
  registerUser,
  loginUser,
  getCurrentUser,
};
