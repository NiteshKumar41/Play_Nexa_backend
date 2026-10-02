function getAllowedOrigins() {
  const configuredOrigin = process.env.CLIENT_URL || process.env.FRONTEND_URL;
  const origins = new Set(configuredOrigin ? [configuredOrigin] : []);

  if (process.env.NODE_ENV !== "production") {
    origins.add("http://localhost:3000");
    origins.add("http://localhost:5173");
  }

  return origins;
}

function isAllowedOrigin(origin) {
  return !origin || getAllowedOrigins().has(origin);
}

module.exports = { getAllowedOrigins, isAllowedOrigin };
