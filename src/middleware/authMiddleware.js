const User = require("../models/User");
const mongoose = require("mongoose");
const { verifyToken } = require("../utils/jwt");

function sendAuthenticationError(response) {
  return response.status(401).json({
    success: false,
    message: "Invalid or expired authentication token",
  });
}

async function authMiddleware(request, response, next) {
  const authorizationHeader = request.headers.authorization;
  const tokenMatch = authorizationHeader?.match(/^Bearer\s+(\S+)$/i);

  if (!tokenMatch) {
    return response.status(401).json({
      success: false,
      message: "Authentication token is required",
    });
  }

  let decodedToken;

  try {
    decodedToken = verifyToken(tokenMatch[1]);
  } catch (error) {
    if (
      error.name === "JsonWebTokenError" ||
      error.name === "TokenExpiredError" ||
      error.name === "NotBeforeError"
    ) {
      return sendAuthenticationError(response);
    }

    return next(error);
  }

  if (!mongoose.isValidObjectId(decodedToken.id)) {
    return sendAuthenticationError(response);
  }

  try {
    const user = await User.findById(decodedToken.id).select(
      "_id role active isBlocked"
    );

    if (!user) {
      return sendAuthenticationError(response);
    }

    if (user.isBlocked) {
      return response.status(403).json({
        success: false,
        message: "This account is blocked",
      });
    }

    if (!user.active) {
      return response.status(403).json({
        success: false,
        message: "This account is inactive",
      });
    }

    request.user = {
      id: user._id.toString(),
      role: user.role,
    };

    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = authMiddleware;
