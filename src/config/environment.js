const jwt = require("jsonwebtoken");

function validateEnvironment() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  const configuredPort = process.env.PORT;
  const port = Number(configuredPort);
  if (
    !process.env.NODE_ENV ||
    !["development", "test", "production"].includes(process.env.NODE_ENV)
  ) {
    throw new Error("NODE_ENV must be development, test, or production");
  }
  if (!configuredPort || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be a valid TCP port");
  }
  const requiredValues = {
    MONGODB_URI: mongoUri,
    JWT_SECRET: process.env.JWT_SECRET,
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN,
    CLIENT_URL: process.env.CLIENT_URL || process.env.FRONTEND_URL,
  };

  const missingVariables = Object.entries(requiredValues)
    .filter(([, value]) => !value || !value.trim())
    .map(([name]) => name);
  if (missingVariables.length) {
    throw new Error(
      `Missing required environment variables: ${missingVariables.join(", ")}`
    );
  }

  if (!/^mongodb(?:\+srv)?:\/\//i.test(mongoUri)) {
    throw new Error("MONGODB_URI must be a valid MongoDB connection URI");
  }
  if (process.env.JWT_SECRET.length < 32) {
    throw new Error("JWT_SECRET must contain at least 32 characters");
  }

  try {
    jwt.sign({ id: "environment-check" }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN,
      algorithm: "HS256",
    });
  } catch {
    throw new Error("JWT_EXPIRES_IN is invalid");
  }

  const clientUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL;
  if (clientUrl) {
    let parsedClientUrl;
    try {
      parsedClientUrl = new URL(clientUrl);
    } catch {
      throw new Error("CLIENT_URL must be a valid HTTP or HTTPS URL");
    }
    if (
      !["http:", "https:"].includes(parsedClientUrl.protocol) ||
      (process.env.NODE_ENV === "production" &&
        parsedClientUrl.protocol !== "https:")
    ) {
      throw new Error("CLIENT_URL must use HTTPS in production");
    }
  }

  return { mongoUri, clientUrl };
}

module.exports = validateEnvironment;
