const multer = require("multer");
const path = require("path");
const {
  MAX_IMAGE_SIZE_BYTES,
  ALLOWED_IMAGE_MIME_TYPES,
  ALLOWED_IMAGE_EXTENSIONS,
} = require("../config/upload");

const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_IMAGE_SIZE_BYTES,
    files: 1,
  },
  fileFilter(request, file, callback) {
    const extension = path.extname(file.originalname).toLowerCase();
    const mimeTypeMatchesExtension =
      file.mimetype === "image/jpeg"
        ? [".jpg", ".jpeg"].includes(extension)
        : file.mimetype === "image/png"
          ? extension === ".png"
          : file.mimetype === "image/webp" && extension === ".webp";

    if (
      !ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype) ||
      !ALLOWED_IMAGE_EXTENSIONS.has(extension) ||
      !mimeTypeMatchesExtension
    ) {
      const error = new Error("File must be a JPG, JPEG, PNG, or WEBP image");
      error.statusCode = 415;
      return callback(error);
    }

    return callback(null, true);
  },
});

module.exports = uploadImage;
