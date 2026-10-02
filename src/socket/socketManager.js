let socketServer;

function setSocketServer(io) {
  socketServer = io;
}

function getSocketServer() {
  if (!socketServer) {
    throw new Error("Socket.IO server has not been initialized");
  }

  return socketServer;
}

module.exports = { setSocketServer, getSocketServer };
