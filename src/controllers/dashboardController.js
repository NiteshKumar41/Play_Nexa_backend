const playerDashboardService = require("../services/playerDashboardService");

async function getSummary(request, response, next) {
  try {
    const summary = await playerDashboardService.getPlayerSummary(request.user.id);
    return response.status(200).json({
      success: true,
      data: summary,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = { getSummary };
