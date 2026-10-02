const userService = require("../services/userService");
const { disconnectUserSockets } = require("../socket/socketEmitter");

async function getUsers(request, response, next) {
  try {
    const data = await userService.getUsers(request.query);
    return response.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
}

async function getUser(request, response, next) {
  try {
    const user = await userService.getUserById(request.params.userId);
    return response.status(200).json({
      success: true,
      data: { user },
    });
  } catch (error) {
    return next(error);
  }
}

async function updateStatus(request, response, next) {
  try {
    const user = await userService.updateUserStatus(
      request.params.userId,
      request.body?.active,
      request.user.id
    );
    if (!user.active || user.isBlocked) {
      disconnectUserSockets(user.id);
    }
    return response.status(200).json({
      success: true,
      message: "User status updated successfully",
      data: { user },
    });
  } catch (error) {
    return next(error);
  }
}

async function updateBlock(request, response, next) {
  try {
    const user = await userService.updateUserBlock(
      request.params.userId,
      request.body?.isBlocked,
      request.user.id
    );
    if (user.isBlocked || !user.active) {
      disconnectUserSockets(user.id);
    }
    return response.status(200).json({
      success: true,
      message: "User block status updated successfully",
      data: { user },
    });
  } catch (error) {
    return next(error);
  }
}

async function updateRole(request, response, next) {
  try {
    const user = await userService.updateUserRole(
      request.params.userId,
      request.body?.userType,
      request.user.id
    );
    if (user.userType !== "admin") {
      disconnectUserSockets(user.id);
    }
    return response.status(200).json({
      success: true,
      message: "User role updated successfully",
      data: { user },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getUsers,
  getUser,
  updateStatus,
  updateBlock,
  updateRole,
};
