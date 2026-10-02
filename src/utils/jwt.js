const jwt = require("jsonwebtoken");

function getJwtSecret() {
  const jwtSecret = process.env.JWT_SECRET;

  if (!jwtSecret) {
    throw new Error("JWT_SECRET is not configured");
  }

  return jwtSecret;
}

function generateToken(user) {
  return jwt.sign(
    {
      id: user._id.toString(),
    },
    getJwtSecret(),
    {
      expiresIn: process.env.JWT_EXPIRES_IN,
      algorithm: "HS256",
    }
  );
}

function verifyToken(token) {
  return jwt.verify(token, getJwtSecret(), { algorithms: ["HS256"] });
}

module.exports = {
  generateToken,
  verifyToken,
};
