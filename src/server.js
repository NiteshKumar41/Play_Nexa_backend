require("dotenv").config();

const validateEnvironment = require("./config/environment");
validateEnvironment();
const app = require("./app");
const connectDatabase = require("./config/database");
const http = require("http");
const { Server } = require("socket.io");
const initializeSocket = require("./socket");
const { setSocketServer } = require("./socket/socketManager");
const { getAllowedOrigins } = require("./config/cors");
const port = process.env.PORT || 5000;
const configuredOrigins = [...getAllowedOrigins()];

async function startServer() {
  await connectDatabase();

  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: configuredOrigins,
      credentials: true,
    },
  });

  setSocketServer(io);
  initializeSocket(io);

  server.listen(port, () => {
    console.log(`Play Nexa API is running on port ${port}`);
  });
}

startServer().catch(error => {
  console.error("Application startup failed:", error.name);
  process.exitCode = 1;
});
