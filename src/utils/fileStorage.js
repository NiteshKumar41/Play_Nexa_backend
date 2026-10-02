const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");

const uploadDirectory = path.resolve(process.cwd(), "uploads/game-results");

function getImageExtension(file) {
  const signatures = [
    {
      extension: ".png",
      matches: buffer =>
        buffer.length >= 8 &&
        buffer.subarray(0, 8).equals(
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        ),
    },
    {
      extension: ".jpg",
      matches: buffer =>
        buffer.length >= 3 &&
        buffer[0] === 0xff &&
        buffer[1] === 0xd8 &&
        buffer[2] === 0xff,
    },
    {
      extension: ".webp",
      matches: buffer =>
        buffer.length >= 12 &&
        buffer.toString("ascii", 0, 4) === "RIFF" &&
        buffer.toString("ascii", 8, 12) === "WEBP",
    },
  ];

  return signatures.find(signature => signature.matches(file.buffer))?.extension;
}

function validateImageFile(file) {
  const extension = getImageExtension(file);
  const expectedExtensions = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
  };

  if (!extension || expectedExtensions[file.mimetype] !== extension) {
    const error = new Error("Uploaded file is not a valid PNG, JPG, or WEBP image");
    error.statusCode = 400;
    throw error;
  }

  return extension;
}

async function saveFile(file) {
  const extension = validateImageFile(file);
  await fs.mkdir(uploadDirectory, { recursive: true });

  const fileName = `${randomUUID()}${extension}`;
  const filePath = path.join(uploadDirectory, fileName);
  await fs.writeFile(filePath, file.buffer, { flag: "wx" });

  return fileName;
}

async function deleteFile(fileName) {
  if (!fileName || path.basename(fileName) !== fileName) return;

  try {
    await fs.unlink(path.join(uploadDirectory, fileName));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function getFileUrl(matchId, fileName) {
  return `/api/v1/matches/${encodeURIComponent(matchId)}/result/evidence/${encodeURIComponent(fileName)}`;
}

function getFileContentType(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  return {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".webp": "image/webp",
  }[extension];
}

async function readFile(fileName) {
  if (!fileName || path.basename(fileName) !== fileName) {
    const error = new Error("Evidence file not found");
    error.statusCode = 404;
    throw error;
  }

  try {
    return await fs.readFile(path.join(uploadDirectory, fileName));
  } catch (error) {
    if (error.code === "ENOENT") {
      const notFoundError = new Error("Evidence file not found");
      notFoundError.statusCode = 404;
      throw notFoundError;
    }
    throw error;
  }
}

module.exports = {
  saveFile,
  deleteFile,
  getFileUrl,
  getFileContentType,
  readFile,
  validateImageFile,
};
