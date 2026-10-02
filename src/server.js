require("dotenv").config();

const app = require("./app");
const connectDatabase = require("./config/database");
const http = require("http");
const { Server } = require("socket.io");
const initializeSocket = require("./socket");
const { setSocketServer } = require("./socket/socketManager");

const port = process.env.PORT || 5000;

async function startServer() {
  await connectDatabase();

  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL || "http://localhost:5173",
      credentials: true,
    },
  });

  setSocketServer(io);
  initializeSocket(io);

  server.listen(port, () => {
    console.log(`Play Nexa API is running on port ${port}`);
  });
}

startServer();
