const multer = require("multer");

function redactSensitiveValues(value) {
  let redacted = value;
  const secrets = [
    process.env.JWT_SECRET,
    process.env.MONGODB_URI,
    process.env.MONGO_URI,
    process.env.CLOUDINARY_API_SECRET,
  ].filter(secret => typeof secret === "string" && secret.length >= 4);

  for (const secret of secrets) {
    redacted = redacted.replace(
      new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
      "[REDACTED]"
    );
  }

  return redacted
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/mongodb(?:\+srv)?:\/\/[^\s"'`]+/gi, "mongodb://[REDACTED]")
    .replace(/(password|secret|api[_-]?key)=([^\s&]+)/gi, "$1=[REDACTED]");
}

function errorMiddleware(error, request, response, next) {
  if (response.headersSent) return next(error);

  let statusCode = error.statusCode || error.status || 500;
  let message = error.message || "Internal server error";
  if (error instanceof multer.MulterError) {
    statusCode = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    message =
      error.code === "LIMIT_FILE_SIZE"
        ? "Uploaded file must be 5 MB or smaller"
        : "Invalid image upload";
  } else if (error.code === 11000) {
    statusCode = 409;
    const duplicateField = Object.keys(error.keyPattern || {})[0];
    message =
      duplicateField === "gameCode"
        ? "Game code already exists"
        : duplicateField === "name"
          ? "Game name already exists"
          : "A record with these details already exists";
  } else if (error.name === "ValidationError" || error.name === "CastError") {
    statusCode = 400;
    message = "Invalid input";
  } else if (
    error.name === "JsonWebTokenError" ||
    error.name === "TokenExpiredError" ||
    error.name === "NotBeforeError"
  ) {
    statusCode = 401;
    message = "Invalid or expired authentication token";
  } else if (error.type === "entity.parse.failed") {
    statusCode = 400;
    message = "Invalid JSON request body";
  } else if (error.type === "entity.too.large") {
    statusCode = 413;
    message = "Request body must be 1 MB or smaller";
  } else if (statusCode >= 500) {
    message = "Internal server error";
  }

  if (!Number.isInteger(statusCode) || statusCode < 400 || statusCode > 599) {
    statusCode = 500;
    message = "Internal server error";
  }

  if (statusCode >= 500) {
    const route = request.route?.path
      ? `${request.baseUrl}${request.route.path}`
      : request.path;
    console.error("Request failed", {
      requestId: request.requestId,
      method: request.method,
      route,
      statusCode,
      errorName: error.name,
      error: redactSensitiveValues(error.stack || error.message || ""),
    });
  }

  response.status(statusCode).json({
    success: false,
    message: statusCode >= 500 ? "Something went wrong" : message,
  });
}

module.exports = errorMiddleware;
