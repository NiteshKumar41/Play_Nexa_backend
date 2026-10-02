const gameService = require("../services/gameService");

async function createGame(request, response, next) {
  try {
    const game = await gameService.createGame(request.body, request.user.id);

    return response.status(201).json({
      success: true,
      message: "Game created successfully",
      data: { game },
    });
  } catch (error) {
    return next(error);
  }
}

async function getGames(request, response, next) {
  try {
    const games = await gameService.getGames();

    return response.status(200).json({
      success: true,
      data: { games },
    });
  } catch (error) {
    return next(error);
  }
}

async function getAdminGames(request, response, next) {
  try {
    const games = await gameService.getAdminGames();

    return response.status(200).json({
      success: true,
      data: { games },
    });
  } catch (error) {
    return next(error);
  }
}

async function getGameById(request, response, next) {
  try {
    const isAdmin = request.user?.role === "admin";
    const game = await gameService.getGameById(request.params.id, isAdmin);

    return response.status(200).json({
      success: true,
      data: { game },
    });
  } catch (error) {
    return next(error);
  }
}

async function updateGame(request, response, next) {
  try {
    const game = await gameService.updateGame(
      request.params.id,
      request.body,
      request.user.id
    );

    return response.status(200).json({
      success: true,
      message: "Game updated successfully",
      data: { game },
    });
  } catch (error) {
    return next(error);
  }
}

async function toggleGameStatus(request, response, next) {
  try {
    const game = await gameService.toggleGameStatus(
      request.params.id,
      request.body?.isActive,
      request.user.id
    );

    return response.status(200).json({
      success: true,
      message: "Game status updated successfully",
      data: { game },
    });
  } catch (error) {
    return next(error);
  }
}

async function toggleGameOpenStatus(request, response, next) {
  try {
    const game = await gameService.toggleGameOpenStatus(
      request.params.id,
      request.body?.isOpen,
      request.user.id
    );

    return response.status(200).json({
      success: true,
      message: "Game open status updated successfully",
      data: { game },
    });
  } catch (error) {
    return next(error);
  }
}

async function deleteGame(request, response, next) {
  try {
    const game = await gameService.deleteGame(
      request.params.id,
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
  getAdminGames,
  getGameById,
  updateGame,
  toggleGameStatus,
  toggleGameOpenStatus,
  deleteGame,
};
