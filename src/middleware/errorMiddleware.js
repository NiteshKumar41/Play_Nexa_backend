const multer = require("multer");

function errorMiddleware(error, request, response, next) {
  let statusCode = error.statusCode || error.status || 500;
  let message = error.message || "Internal server error";

  if (error instanceof multer.MulterError) {
    statusCode = 400;
    message =
      error.code === "LIMIT_FILE_SIZE"
        ? "Screenshot must be 5 MB or smaller"
        : "Invalid screenshot upload";
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
  } else if (error.type === "entity.parse.failed") {
    statusCode = 400;
    message = "Invalid JSON request body";
  } else if (statusCode >= 500) {
    message = "Internal server error";
  }

  response.status(statusCode).json({
    success: false,
    message,
  });
}

module.exports = errorMiddleware;
