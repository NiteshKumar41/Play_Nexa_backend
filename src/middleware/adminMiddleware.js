function adminMiddleware(request, response, next) {
  if (!request.user) {
    return response.status(401).json({
      success: false,
      message: "Authentication is required",
    });
  }

  const isAdmin = request.user.role === "admin";

  if (!isAdmin) {
    return response.status(403).json({
      success: false,
      message: "Admin access is required",
    });
  }

  return next();
}

module.exports = adminMiddleware;
