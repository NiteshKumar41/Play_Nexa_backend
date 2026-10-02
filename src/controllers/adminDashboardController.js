const dashboardService = require("../services/dashboardService");

async function getSummary(request, response, next) {
  try {
    const summary = await dashboardService.getSummary(request.query);
    return response.status(200).json({
      success: true,
      data: summary,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = { getSummary };
