const multer = require("multer");

const allowedMimeTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

const uploadScreenshot = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
  },
  fileFilter(request, file, callback) {
    if (!allowedMimeTypes.has(file.mimetype)) {
      const error = new Error("Screenshot must be PNG, JPG, JPEG, or WEBP");
      error.statusCode = 400;
      return callback(error);
    }

    return callback(null, true);
  },
});

module.exports = uploadScreenshot;
