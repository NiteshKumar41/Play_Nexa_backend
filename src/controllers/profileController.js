const userService = require("../services/userService");

async function getMe(request, response, next) {
  try {
    const profile = await userService.getOwnProfile(request.user.id);
    return response.status(200).json({
      success: true,
      data: { profile },
    });
  } catch (error) {
    return next(error);
  }
}

async function updateMe(request, response, next) {
  try {
    const profile = await userService.updateOwnProfile(
      request.user.id,
      request.body
    );
    return response.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: { profile },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = { getMe, updateMe };
