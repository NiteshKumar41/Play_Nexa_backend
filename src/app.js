const express = require("express");
const cors = require("cors");
const errorMiddleware = require("./middleware/errorMiddleware");

const app = express();

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
  })
);
app.use(express.json());

app.get("/api/health", (request, response) => {
  response.json({
    success: true,
    message: "Play Nexa API is running",
  });
});

app.use("/api/v1/auth", require("./routes/authRoutes"));
app.use("/api/v1/wallet", require("./routes/walletRoutes"));
app.use("/api/v1/games", require("./routes/gameRoutes"));
app.use("/api/v1/matches", require("./routes/matchRoutes"));
app.use("/api/v1/matches", require("./routes/resultRoutes"));

app.use(errorMiddleware);

module.exports = app;
