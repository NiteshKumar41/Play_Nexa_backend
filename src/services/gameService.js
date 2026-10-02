const mongoose = require("mongoose");
const Game = require("../models/Game");
const fileStorage = require("../utils/fileStorage");

const GAME_NAME_COLLATION = { locale: "en", strength: 2 };
const GAME_FIELDS = "gameCode name imageUrl isActive isOpen";

function createGameError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function formatGame(game, includeAdminFields = false) {
  const formattedGame = {
    id: game._id.toString(),
    gameCode: game.gameCode,
    name: game.name,
    imageUrl: game.imageUrl,
    isActive: game.isActive,
    isOpen: game.isOpen,
  };

  if (includeAdminFields) {
    formattedGame.createdBy = game.createdBy.toString();
    formattedGame.updatedBy = game.updatedBy?.toString();
    formattedGame.createdAt = game.createdAt;
    formattedGame.updatedAt = game.updatedAt;
  }

  return formattedGame;
}

function validateGameId(gameId) {
  if (!mongoose.isValidObjectId(gameId)) {
    throw createGameError("Invalid game ID", 400);
  }
}

function validateGameCode(gameCode) {
  if (
    typeof gameCode !== "number" ||
    !Number.isSafeInteger(gameCode) ||
    gameCode < 1
  ) {
    throw createGameError("Game code must be a positive integer", 400);
  }
}

function validateGameName(name) {
  if (typeof name !== "string" || !name.trim()) {
    throw createGameError("Game name is required", 400);
  }
}

function validateImageUrl(imageUrl) {
  if (imageUrl === undefined || imageUrl === null || imageUrl === "") {
    return;
  }

  if (typeof imageUrl !== "string") {
    throw createGameError("Image URL must be a valid HTTP or HTTPS URL", 400);
  }

  if (/^\/api\/v1\/games\/image\/game_[\w-]+\.(png|jpg|webp)$/i.test(imageUrl)) {
    return;
  }

  try {
    const parsedUrl = new URL(imageUrl);

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      throw new Error("Unsupported URL protocol");
    }
  } catch {
    throw createGameError("Image URL must be a valid HTTP or HTTPS URL", 400);
  }
}

function getGameFields(requestData, allowedFields) {
  if (
    !requestData ||
    typeof requestData !== "object" ||
    Array.isArray(requestData)
  ) {
    throw createGameError("Invalid game details", 400);
  }

  const unexpectedFields = Object.keys(requestData).filter(
    field => !allowedFields.includes(field)
  );

  if (unexpectedFields.length > 0) {
    throw createGameError(
      `These fields cannot be changed: ${unexpectedFields.join(", ")}`,
      400
    );
  }

  return requestData;
}

async function findDuplicateGame({ gameCode, name, excludeGameId }) {
  const duplicateConditions = [];

  if (gameCode !== undefined) {
    duplicateConditions.push({ gameCode });
  }

  if (name !== undefined) {
    duplicateConditions.push({ name: name.trim() });
  }

  if (duplicateConditions.length === 0) {
    return null;
  }

  const query = { $or: duplicateConditions };

  if (excludeGameId) {
    query._id = { $ne: excludeGameId };
  }

  return Game.findOne(query).collation(GAME_NAME_COLLATION);
}

function getDuplicateError(error) {
  const duplicateField = Object.keys(error.keyPattern || {})[0];

  if (duplicateField === "gameCode") {
    return createGameError("Game code already exists", 409);
  }

  if (duplicateField === "name") {
    return createGameError("Game name already exists", 409);
  }

  return createGameError("A game with these details already exists", 409);
}

async function createGame(gameDetails, adminUserId) {
  if (!mongoose.isValidObjectId(adminUserId)) {
    throw createGameError("Invalid admin user", 400);
  }

  const { gameCode, name, imageUrl } = getGameFields(gameDetails, [
    "gameCode",
    "name",
    "imageUrl",
    "isActive",
    "isOpen",
  ]);

  validateGameCode(gameCode);
  validateGameName(name);
  validateImageUrl(imageUrl);
  if (
    gameDetails.isActive !== undefined &&
    typeof gameDetails.isActive !== "boolean"
  ) {
    throw createGameError("isActive must be a boolean", 400);
  }
  if (
    gameDetails.isOpen !== undefined &&
    typeof gameDetails.isOpen !== "boolean"
  ) {
    throw createGameError("isOpen must be a boolean", 400);
  }

  const normalizedName = name.trim();
  const existingGame = await findDuplicateGame({
    gameCode,
    name: normalizedName,
  });

  if (existingGame) {
    if (existingGame.gameCode === gameCode) {
      throw createGameError("Game code already exists", 409);
    }

    throw createGameError("Game name already exists", 409);
  }

  try {
    const game = await Game.create({
      gameCode,
      name: normalizedName,
      imageUrl: imageUrl || undefined,
      isActive: gameDetails.isActive ?? true,
      isOpen: gameDetails.isOpen ?? false,
      createdBy: adminUserId,
    });

    return formatGame(game, true);
  } catch (error) {
    if (error.code === 11000) {
      throw getDuplicateError(error);
    }

    throw error;
  }
}

async function getGames() {
  const games = await Game.find({ isActive: true })
    .select(GAME_FIELDS)
    .sort({ createdAt: -1, _id: -1 });

  return games.map(game => formatGame(game));
}

async function getAdminGames({ page = 1, limit = 20 } = {}) {
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    throw createGameError("Page must be positive and limit must be 1-100", 400);
  }
  const [games, total] = await Promise.all([
    Game.find({})
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Game.countDocuments({}),
  ]);

  return {
    games: games.map(game => formatGame(game, true)),
    pagination: {
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    },
  };
}

async function getGameById(gameId, isAdmin = false) {
  validateGameId(gameId);

  const query = { _id: gameId };

  if (!isAdmin) {
    query.isActive = true;
  }

  const game = await Game.findOne(query);

  if (!game) {
    throw createGameError("Game not found", 404);
  }

  return formatGame(game, isAdmin);
}

async function getGameImage(fileName, isAdmin = false) {
  if (
    typeof fileName !== "string" ||
    !/^game_[\w-]+\.(png|jpg|webp)$/i.test(fileName)
  ) {
    throw createGameError("Game image not found", 404);
  }
  const imageUrl = fileStorage.getGameImageUrl(fileName);
  const query = { imageUrl };
  if (!isAdmin) query.isActive = true;

  const game = await Game.findOne(query).select("_id").lean();
  if (!game) throw createGameError("Game image not found", 404);
  return {
    buffer: await fileStorage.readGameImage(fileName),
    contentType: fileStorage.getFileContentType(fileName),
  };
}

async function updateGame(gameId, gameDetails, adminUserId) {
  validateGameId(gameId);

  if (!mongoose.isValidObjectId(adminUserId)) {
    throw createGameError("Invalid admin user", 400);
  }

  const updates = getGameFields(gameDetails, [
    "gameCode",
    "name",
    "imageUrl",
    "isActive",
    "isOpen",
  ]);

  if (Object.keys(updates).length === 0) {
    throw createGameError("At least one game field must be provided", 400);
  }

  if (Object.hasOwn(updates, "gameCode")) {
    validateGameCode(updates.gameCode);
  }

  if (Object.hasOwn(updates, "name")) {
    validateGameName(updates.name);
    updates.name = updates.name.trim();
  }

  if (Object.hasOwn(updates, "imageUrl")) {
    validateImageUrl(updates.imageUrl);
    updates.imageUrl = updates.imageUrl || undefined;
  }
  for (const fieldName of ["isActive", "isOpen"]) {
    if (
      Object.hasOwn(updates, fieldName) &&
      typeof updates[fieldName] !== "boolean"
    ) {
      throw createGameError(`${fieldName} must be a boolean`, 400);
    }
  }

  const existingGame = await findDuplicateGame({
    gameCode: updates.gameCode,
    name: updates.name,
    excludeGameId: gameId,
  });

  if (existingGame) {
    if (
      updates.gameCode !== undefined &&
      existingGame.gameCode === updates.gameCode
    ) {
      throw createGameError("Game code already exists", 409);
    }

    throw createGameError("Game name already exists", 409);
  }

  try {
    const game = await Game.findByIdAndUpdate(
      gameId,
      {
        $set: {
          ...updates,
          updatedBy: adminUserId,
        },
      },
      { new: true, runValidators: true }
    );

    if (!game) {
      throw createGameError("Game not found", 404);
    }

    return formatGame(game, true);
  } catch (error) {
    if (error.code === 11000) {
      throw getDuplicateError(error);
    }

    throw error;
  }
}

async function toggleGameStatus(gameId, isActive, adminUserId) {
  validateGameId(gameId);

  if (typeof isActive !== "boolean") {
    throw createGameError("isActive must be a boolean", 400);
  }

  const game = await Game.findByIdAndUpdate(
    gameId,
    {
      $set: {
        isActive,
        updatedBy: adminUserId,
      },
    },
    { new: true, runValidators: true }
  );

  if (!game) {
    throw createGameError("Game not found", 404);
  }

  return formatGame(game, true);
}

async function toggleGameOpenStatus(gameId, isOpen, adminUserId) {
  validateGameId(gameId);

  if (typeof isOpen !== "boolean") {
    throw createGameError("isOpen must be a boolean", 400);
  }

  const game = await Game.findByIdAndUpdate(
    gameId,
    {
      $set: {
        isOpen,
        updatedBy: adminUserId,
      },
    },
    { new: true, runValidators: true }
  );

  if (!game) {
    throw createGameError("Game not found", 404);
  }

  return formatGame(game, true);
}

async function deleteGame(gameId, adminUserId) {
  validateGameId(gameId);

  const game = await Game.findByIdAndUpdate(
    gameId,
    {
      $set: {
        isActive: false,
        isOpen: false,
        updatedBy: adminUserId,
      },
    },
    { new: true, runValidators: true }
  );

  if (!game) {
    throw createGameError("Game not found", 404);
  }

  return formatGame(game, true);
}

module.exports = {
  createGame,
  getGames,
  getAdminGames,
  getGameById,
  getGameImage,
  updateGame,
  toggleGameStatus,
  toggleGameOpenStatus,
  deleteGame,
};
