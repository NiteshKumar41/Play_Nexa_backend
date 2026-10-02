const { randomUUID } = require("crypto");
const { rateLimit } = require("express-rate-limit");

function createRateLimiter(windowMs, limit, message) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    handler(request, response) {
      return response.status(429).json({
        success: false,
        message,
      });
    },
  });
}

const apiRateLimiter = createRateLimiter(
  15 * 60 * 1000,
  100,
  "Too many requests. Please try again later."
);
const authenticationRateLimiter = createRateLimiter(
  15 * 60 * 1000,
  10,
  "Too many authentication attempts. Please try again later."
);
const financialWriteRateLimiter = createRateLimiter(
  15 * 60 * 1000,
  30,
  "Too many requests. Please try again later."
);

function requestContextMiddleware(request, response, next) {
  request.requestId = randomUUID();
  response.setHeader("X-Request-Id", request.requestId);

  const startedAt = Date.now();
  response.on("finish", () => {
    console.info("HTTP request", {
      requestId: request.requestId,
      method: request.method,
      route: `${request.baseUrl}${request.path}`,
      statusCode: response.statusCode,
      durationMs: Date.now() - startedAt,
    });
  });

  return next();
}

module.exports = {
  apiRateLimiter,
  authenticationRateLimiter,
  financialWriteRateLimiter,
  requestContextMiddleware,
};
