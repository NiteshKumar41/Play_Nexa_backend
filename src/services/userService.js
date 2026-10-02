const mongoose = require("mongoose");
const User = require("../models/User");
const Wallet = require("../models/Wallet");

function createUserError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function validateUserId(userId) {
  if (!mongoose.isValidObjectId(userId)) {
    throw createUserError("Invalid user ID", 400);
  }
}

function parseBooleanFilter(value, label) {
  if (value === undefined) return undefined;
  if (value === "true" || value === true) return true;
  if (value === "false" || value === false) return false;
  throw createUserError(`${label} must be true or false`, 400);
}

function getPagination(query) {
  const page = Number(query.page ?? 1);
  const limit = Number(query.limit ?? 20);
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    throw createUserError("Page must be positive and limit must be 1-100", 400);
  }
  return { page, limit };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatUser(user) {
  return {
    id: user._id.toString(),
    name: user.fullName,
    phone: user.phone,
    email: user.email || null,
    dob: user.dob || null,
    gender: user.gender || null,
    upiId: user.upiId || null,
    userType: user.role,
    active: user.active,
    isBlocked: user.isBlocked,
    createdAt: user.createdAt,
  };
}

async function lockAvailableAdminRoster(session) {
  const availableAdmin = await User.findOne({
    role: "admin",
    active: true,
    isBlocked: false,
  })
    .sort({ _id: 1 })
    .select("_id")
    .session(session);
  if (!availableAdmin) {
    throw createUserError("At least one active admin is required.", 409);
  }

  await User.updateOne(
    { _id: availableAdmin._id },
    { $inc: { adminSafetyVersion: 1 } },
    { session }
  );
}

async function getUsers(query = {}) {
  const { page, limit } = getPagination(query);
  const filter = {};
  const active = parseBooleanFilter(query.active, "active");
  const blocked = parseBooleanFilter(query.blocked, "blocked");
  if (active !== undefined) filter.active = active;
  if (blocked !== undefined) filter.isBlocked = blocked;

  const userType = query.userType ?? query.role;
  if (userType !== undefined) {
    if (!["player", "admin"].includes(userType)) {
      throw createUserError("userType must be player or admin", 400);
    }
    filter.role = userType;
  }

  if (query.search !== undefined) {
    if (typeof query.search !== "string" || query.search.trim().length > 100) {
      throw createUserError("Search must be 100 characters or fewer", 400);
    }
    const search = escapeRegex(query.search.trim());
    if (search) {
      filter.$or = [
        { fullName: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }
  }

  const [users, total] = await Promise.all([
    User.find(filter)
      .select("_id fullName phone email role active isBlocked createdAt dob gender upiId")
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    User.countDocuments(filter),
  ]);
  return {
    users: users.map(formatUser),
    pagination: {
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    },
  };
}

async function getUserById(userId) {
  validateUserId(userId);
  const user = await User.findById(userId)
    .select("_id fullName phone email dob gender upiId role active isBlocked createdAt")
    .lean();
  if (!user) throw createUserError("User not found", 404);

  const wallet = await Wallet.findOne({ userId }).select("balance").lean();
  return {
    ...formatUser(user),
    wallet: { balance: wallet?.balance ?? 0 },
  };
}

async function updateBooleanField(userId, fieldName, value, adminId) {
  validateUserId(userId);
  if (!mongoose.isValidObjectId(adminId)) {
    throw createUserError("Invalid admin ID", 400);
  }
  if (typeof value !== "boolean") {
    throw createUserError(`${fieldName} must be a boolean`, 400);
  }

  const session = await mongoose.startSession();
  let updatedUser;
  try {
    await session.withTransaction(async () => {
      const target = await User.findById(userId).session(session);
      if (!target) throw createUserError("User not found", 404);
      const willBeAvailableAdmin =
        target.role === "admin" &&
        (fieldName === "active" ? value : target.active) &&
        (fieldName === "isBlocked" ? !value : !target.isBlocked);

      const targetIsCurrentlyAvailable =
        target.role === "admin" && target.active && !target.isBlocked;
      if (targetIsCurrentlyAvailable && !willBeAvailableAdmin) {
        await lockAvailableAdminRoster(session);
        const availableAdmins = await User.countDocuments({
          role: "admin",
          active: true,
          isBlocked: false,
        }).session(session);
        if (availableAdmins <= 1) {
          throw createUserError(
            "At least one active admin is required.",
            409
          );
        }
      }

      updatedUser = await User.findByIdAndUpdate(
        userId,
        {
          $set: {
            [fieldName]: value,
            adminUpdatedBy: adminId,
          },
        },
        { new: true, runValidators: true, session }
      );
    });
  } finally {
    await session.endSession();
  }
  return formatUser(updatedUser);
}

async function updateUserStatus(userId, active, adminId) {
  return updateBooleanField(userId, "active", active, adminId);
}

async function updateUserBlock(userId, isBlocked, adminId) {
  return updateBooleanField(userId, "isBlocked", isBlocked, adminId);
}

async function updateUserRole(userId, userType, adminId) {
  validateUserId(userId);
  if (!mongoose.isValidObjectId(adminId)) {
    throw createUserError("Invalid admin ID", 400);
  }
  if (!["player", "admin"].includes(userType)) {
    throw createUserError("userType must be player or admin", 400);
  }

  const session = await mongoose.startSession();
  let updatedUser;
  try {
    await session.withTransaction(async () => {
      const target = await User.findById(userId).session(session);
      if (!target) throw createUserError("User not found", 404);
      if (
        target.role === "admin" &&
        userType !== "admin" &&
        target.active &&
        !target.isBlocked
      ) {
        await lockAvailableAdminRoster(session);
        const availableAdmins = await User.countDocuments({
          role: "admin",
          active: true,
          isBlocked: false,
        }).session(session);
        if (availableAdmins <= 1) {
          throw createUserError(
            "At least one active admin is required.",
            409
          );
        }
      }
      updatedUser = await User.findByIdAndUpdate(
        userId,
        { $set: { role: userType, adminUpdatedBy: adminId } },
        { new: true, runValidators: true, session }
      );
    });
  } finally {
    await session.endSession();
  }
  return formatUser(updatedUser);
}

module.exports = {
  getUsers,
  getUserById,
  updateUserStatus,
  updateUserBlock,
  updateUserRole,
};
