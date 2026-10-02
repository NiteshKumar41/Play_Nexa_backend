const gameService = require("../services/gameService");
const fileStorage = require("../utils/fileStorage");

function parseBoolean(value, fieldName) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  const error = new Error(`${fieldName} must be true or false`);
  error.statusCode = 400;
  throw error;
}

function normalizeGameInput(body, imageUrl) {
  const allowedFields = ["name", "gameCode", "status", "isOpen"];
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some(field => !allowedFields.includes(field))
  ) {
    const error = new Error("Invalid game details");
    error.statusCode = 400;
    throw error;
  }

  const gameDetails = { ...body };
  if (gameDetails.gameCode !== undefined) {
    if (
      typeof gameDetails.gameCode === "string" &&
      /^\d+$/.test(gameDetails.gameCode.trim())
    ) {
      gameDetails.gameCode = Number(gameDetails.gameCode);
    }
  }
  if (gameDetails.status !== undefined) {
    gameDetails.isActive = parseBoolean(gameDetails.status, "status");
    delete gameDetails.status;
  }
  if (gameDetails.isOpen !== undefined) {
    gameDetails.isOpen = parseBoolean(gameDetails.isOpen, "isOpen");
  }
  delete gameDetails.image;
  if (imageUrl !== undefined) gameDetails.imageUrl = imageUrl;
  return gameDetails;
}

async function createGame(request, response, next) {
  let imageFileName;
  try {
    if (request.file) {
      imageFileName = await fileStorage.saveGameImage(request.file);
    }
    const gameDetails = normalizeGameInput(
      request.body,
      imageFileName ? fileStorage.getGameImageUrl(imageFileName) : undefined
    );
    const game = await gameService.createGame(gameDetails, request.user.id);
    return response.status(201).json({
      success: true,
      message: "Game created successfully",
      data: { game },
    });
  } catch (error) {
    if (imageFileName) await fileStorage.deleteGameImage(imageFileName);
    return next(error);
  }
}

async function getGames(request, response, next) {
  try {
    const page = Number(request.query.page ?? 1);
    const limit = Number(request.query.limit ?? 20);
    const data = await gameService.getAdminGames({ page, limit });
    return response.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
}

async function getGame(request, response, next) {
  try {
    const game = await gameService.getGameById(request.params.gameId, true);
    return response.status(200).json({
      success: true,
      data: { game },
    });
  } catch (error) {
    return next(error);
  }
}

async function updateGame(request, response, next) {
  let imageFileName;
  try {
    const previousGame = await gameService.getGameById(
      request.params.gameId,
      true
    );
    if (request.file) {
      imageFileName = await fileStorage.saveGameImage(request.file);
    }
    const gameDetails = normalizeGameInput(
      request.body,
      imageFileName ? fileStorage.getGameImageUrl(imageFileName) : undefined
    );
    const game = await gameService.updateGame(
      request.params.gameId,
      gameDetails,
      request.user.id
    );

    const previousFileName = previousGame.imageUrl?.match(
      /^\/api\/v1\/games\/image\/(game_[\w-]+\.(?:png|jpg|webp))$/i
    )?.[1];
    if (imageFileName && previousFileName) {
      try {
        await fileStorage.deleteGameImage(previousFileName);
      } catch (error) {
        console.error("Unable to remove replaced game image:", error.message);
      }
    }

    return response.status(200).json({
      success: true,
      message: "Game updated successfully",
      data: { game },
    });
  } catch (error) {
    if (imageFileName) await fileStorage.deleteGameImage(imageFileName);
    return next(error);
  }
}

async function deleteGame(request, response, next) {
  try {
    const game = await gameService.deleteGame(
      request.params.gameId,
      request.user.id
    );
    return response.status(200).json({
      success: true,
      message: "Game deactivated successfully",
      data: { game },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createGame,
  getGames,
  getGame,
  updateGame,
  deleteGame,
};
