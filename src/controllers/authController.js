const authService = require("../services/authService");

async function signup(request, response, next) {
  try {
    const result = await authService.registerUser(request.body);

    return response.status(201).json({
      success: true,
      message: "Account created successfully",
      data: result,
    });
  } catch (error) {
    return next(error);
  }
}

async function login(request, response, next) {
  try {
    const result = await authService.loginUser(request.body);

    return response.status(200).json({
      success: true,
      message: "Login successful",
      data: result,
    });
  } catch (error) {
    return next(error);
  }
}

async function getCurrentUser(request, response, next) {
  try {
    const user = await authService.getCurrentUser(request.user.id);

    return response.status(200).json({
      success: true,
      data: { user },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  signup,
  login,
  getCurrentUser,
};
