const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const User = require("../models/User");
const walletService = require("./walletService");
const { generateToken } = require("../utils/jwt");

function createAuthError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
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
  };
}

async function registerUser(userData) {
  if (!userData || typeof userData !== "object" || Array.isArray(userData)) {
    throw createAuthError("Invalid signup details", 400);
  }

  const {
    fullName,
    phone,
    password,
    email,
    dob,
    gender,
    upiId,
  } = userData;

  validateSignupDetails({ fullName, phone, password });

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
          },
        ],
        { session }
      );

      await walletService.createWallet(user._id, session);
      token = generateToken(user);
    });
  } catch (error) {
    if (error.code === 11000) {
      throw createAuthError("Phone number already registered", 409);
    }

    throw error;
  } finally {
    await session.endSession();
  }

  return {
    user: getSafeUser(user),
    token,
  };
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
    throw createAuthError("Invalid phone number or password", 401);
  }

  const user = await User.findOne({ phone: phone.trim() }).select("+password");

  if (!user) {
    throw createAuthError("Invalid phone number or password", 401);
  }

  if (user.isBlocked) {
    throw createAuthError("This account is blocked", 403);
  }

  if (!user.active) {
    throw createAuthError("This account is inactive", 403);
  }

  const isPasswordCorrect = await bcrypt.compare(password, user.password);

  if (!isPasswordCorrect) {
    throw createAuthError("Invalid phone number or password", 401);
  }

  return {
    user: getSafeUser(user),
    token: generateToken(user),
  };
}

async function getCurrentUser(userId) {
  const user = await User.findById(userId);

  if (!user) {
    throw createAuthError("User account not found", 404);
  }

  return getSafeUser(user);
}

module.exports = {
  registerUser,
  loginUser,
  getCurrentUser,
};
