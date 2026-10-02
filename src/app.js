const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const errorMiddleware = require("./middleware/errorMiddleware");
const {
  apiRateLimiter,
  requestContextMiddleware,
} = require("./middleware/securityMiddleware");
const { isAllowedOrigin } = require("./config/cors");

const app = express();

app.disable("x-powered-by");
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    strictTransportSecurity:
      process.env.NODE_ENV === "production"
        ? { maxAge: 31536000, includeSubDomains: true }
        : false,
  })
);
app.use(requestContextMiddleware);
app.use(
  cors({
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) return callback(null, true);
      const error = new Error("Origin is not allowed by CORS");
      error.statusCode = 403;
      return callback(error);
    },
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(
  express.urlencoded({
    extended: false,
    limit: "1mb",
    parameterLimit: 1000,
  })
);
app.use("/api/v1", apiRateLimiter);

function sendHealthResponse(request, response) {
  response.json({
    success: true,
    message: "Play Nexa backend is healthy",
  });
}

app.get("/health", sendHealthResponse);
app.get("/api/health", sendHealthResponse);

app.use("/api/v1/auth", require("./routes/authRoutes"));
app.use("/api/v1/wallet", require("./routes/walletRoutes"));
app.use("/api/v1/wallet/withdrawals", require("./routes/withdrawalRoutes"));
app.use("/api/v1/support", require("./routes/supportRoutes"));
app.use("/api/v1/games", require("./routes/gameRoutes"));
app.use("/api/v1/matches", require("./routes/matchRoutes"));
app.use("/api/v1/matches", require("./routes/resultRoutes"));
app.use("/api/v1/admin", require("./routes/adminSettlementRoutes"));
app.use("/api/v1/admin", require("./routes/adminDepositRoutes"));
app.use("/api/v1/admin/withdrawals", require("./routes/adminWithdrawalRoutes"));
app.use("/api/v1/admin/support", require("./routes/adminSupportRoutes"));
app.use("/api/v1/admin/dashboard", require("./routes/adminDashboardRoutes"));
app.use("/api/v1/admin/users", require("./routes/adminUserRoutes"));
app.use("/api/v1/admin/games", require("./routes/adminGameRoutes"));
app.use("/api/v1/admin/matches", require("./routes/adminMatchRoutes"));
app.use("/api/v1/admin/payment-methods", require("./routes/adminPaymentMethodRoutes"));
app.use("/api/v1/payment-methods", require("./routes/paymentMethodRoutes"));

app.use((request, response) =>
  response.status(404).json({
    success: false,
    message: "Route not found",
  })
);

app.use(errorMiddleware);

module.exports = app;
