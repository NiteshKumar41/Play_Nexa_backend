const mongoose = require("mongoose");
const User = require("../models/User");
const { verifyToken } = require("../utils/jwt");

async function socketAuth(socket, next) {
  const token = socket.handshake.auth?.token;

  if (typeof token !== "string" || !token.trim()) {
    return next(new Error("Authentication token is required"));
  }

  let decodedToken;

  try {
    decodedToken = verifyToken(token);
  } catch (error) {
    return next(new Error("Invalid or expired authentication token"));
  }

  if (!mongoose.isValidObjectId(decodedToken.id)) {
    return next(new Error("Invalid or expired authentication token"));
  }

  try {
    const user = await User.findById(decodedToken.id).select(
      "_id role active isBlocked"
    );

    if (!user || user.active !== true || user.isBlocked !== false) {
      return next(new Error("This account cannot access realtime features"));
    }

    socket.user = {
      id: user._id.toString(),
      role: user.role,
    };

    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = socketAuth;
