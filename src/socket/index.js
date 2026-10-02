const mongoose = require("mongoose");
const Game = require("../models/Game");
const GameMatch = require("../models/GameMatch");
const socketAuth = require("./socketAuth");
const { SOCKET_EVENTS } = require("./socketEvents");

function emitSocketError(socket, message) {
  socket.emit(SOCKET_EVENTS.SOCKET_ERROR, { message });
}

function initializeSocket(io) {
  io.use(socketAuth);

  io.on("connection", socket => {
    console.log(`Socket connected: ${socket.user.id}`);

    socket.on("join_game_lobby", async payload => {
      const gameId = payload?.gameId;

      if (!mongoose.isValidObjectId(gameId)) {
        return emitSocketError(socket, "Invalid game");
      }

      try {
        const game = await Game.findOne({ _id: gameId, isActive: true })
          .select("_id")
          .lean();

        if (!game) {
          return emitSocketError(socket, "Game not found or inactive");
        }

        await socket.join(`game:lobby:${game._id}`);
        console.log(`Joined lobby: ${game._id}`);
      } catch (error) {
        console.error("Socket lobby join failed:", error.message);
        emitSocketError(socket, "Unable to join game lobby");
      }
    });

    socket.on("leave_game_lobby", payload => {
      const gameId = payload?.gameId;

      if (!mongoose.isValidObjectId(gameId)) {
        return emitSocketError(socket, "Invalid game");
      }

      socket.leave(`game:lobby:${gameId}`);
    });

    socket.on("join_match_room", async payload => {
      const matchId = payload?.matchId;

      if (!mongoose.isValidObjectId(matchId)) {
        return emitSocketError(socket, "Invalid match");
      }

      try {
        const match = await GameMatch.findById(matchId)
          .select("_id player1 player2")
          .lean();

        if (
          !match ||
          (match.player1.toString() !== socket.user.id &&
            match.player2?.toString() !== socket.user.id)
        ) {
          return emitSocketError(
            socket,
            "You are not allowed to join this match"
          );
        }

        await socket.join(`match:${match._id}`);
        console.log(`Joined match: ${match._id}`);
      } catch (error) {
        console.error("Socket match join failed:", error.message);
        emitSocketError(socket, "Unable to join match room");
      }
    });

    socket.on("leave_match_room", payload => {
      const matchId = payload?.matchId;

      if (!mongoose.isValidObjectId(matchId)) {
        return emitSocketError(socket, "Invalid match");
      }

      socket.leave(`match:${matchId}`);
    });

    socket.on("disconnect", () => {
      console.log(`Socket disconnected: ${socket.user.id}`);
    });
  });
}

module.exports = initializeSocket;
