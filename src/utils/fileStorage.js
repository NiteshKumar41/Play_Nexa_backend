const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");
const {
  MAX_IMAGE_SIZE_BYTES,
} = require("../config/upload");

const uploadDirectory = path.resolve(process.cwd(), "uploads/game-results");
const depositUploadDirectory = path.resolve(process.cwd(), "uploads/deposits");
const paymentMethodUploadDirectory = path.resolve(
  process.cwd(),
  "uploads/payment-methods"
);
const supportUploadDirectory = path.resolve(process.cwd(), "uploads/support");
const gameUploadDirectory = path.resolve(process.cwd(), "uploads/games");

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
  if (!Buffer.isBuffer(file?.buffer)) {
    const error = new Error("Uploaded file must be an image");
    error.statusCode = 415;
    throw error;
  }
  if (file.buffer.length > MAX_IMAGE_SIZE_BYTES) {
    const error = new Error("Uploaded image must be 5 MB or smaller");
    error.statusCode = 413;
    throw error;
  }
  const extension = getImageExtension(file);
  const expectedExtensions = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
  };

  if (!extension || expectedExtensions[file.mimetype] !== extension) {
    const error = new Error("Uploaded file is not a valid PNG, JPG, or WEBP image");
    error.statusCode = 415;
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

async function saveDepositProof(file) {
  const extension = validateImageFile(file);
  await fs.mkdir(depositUploadDirectory, { recursive: true });

  const fileName = `deposit_${randomUUID()}${extension}`;
  await fs.writeFile(path.join(depositUploadDirectory, fileName), file.buffer, {
    flag: "wx",
  });
  return fileName;
}

async function savePaymentMethodQr(file) {
  const extension = validateImageFile(file);
  await fs.mkdir(paymentMethodUploadDirectory, { recursive: true });

  const fileName = `payment_${randomUUID()}${extension}`;
  await fs.writeFile(
    path.join(paymentMethodUploadDirectory, fileName),
    file.buffer,
    { flag: "wx" }
  );
  return fileName;
}

async function saveSupportImage(file) {
  const extension = validateImageFile(file);
  await fs.mkdir(supportUploadDirectory, { recursive: true });

  const fileName = `support_${randomUUID()}${extension}`;
  await fs.writeFile(path.join(supportUploadDirectory, fileName), file.buffer, {
    flag: "wx",
  });
  return fileName;
}

async function saveGameImage(file) {
  const extension = validateImageFile(file);
  await fs.mkdir(gameUploadDirectory, { recursive: true });

  const fileName = `game_${randomUUID()}${extension}`;
  await fs.writeFile(path.join(gameUploadDirectory, fileName), file.buffer, {
    flag: "wx",
  });
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

async function deleteStoredFile(fileName, directory) {
  if (!fileName || path.basename(fileName) !== fileName) return;

  try {
    await fs.unlink(path.join(directory, fileName));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function getFileUrl(matchId, fileName) {
  return `/api/v1/matches/${encodeURIComponent(matchId)}/result/evidence/${encodeURIComponent(fileName)}`;
}

function getDepositProofUrl(transactionId, fileName) {
  return `/api/v1/wallet/deposits/${encodeURIComponent(transactionId)}/proof/${encodeURIComponent(fileName)}`;
}

function getPaymentMethodQrUrl(paymentMethodId, fileName) {
  return `/api/v1/payment-methods/${encodeURIComponent(paymentMethodId)}/qr/${encodeURIComponent(fileName)}`;
}

function getSupportImageUrl(ticketId, fileName) {
  return `/api/v1/support/tickets/${encodeURIComponent(ticketId)}/image/${encodeURIComponent(fileName)}`;
}

function getGameImageUrl(fileName) {
  return `/api/v1/games/image/${encodeURIComponent(fileName)}`;
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

async function readStoredFile(fileName, directory) {
  if (!fileName || path.basename(fileName) !== fileName) {
    const error = new Error("File not found");
    error.statusCode = 404;
    throw error;
  }

  try {
    return await fs.readFile(path.join(directory, fileName));
  } catch (error) {
    if (error.code === "ENOENT") {
      const notFoundError = new Error("File not found");
      notFoundError.statusCode = 404;
      throw notFoundError;
    }
    throw error;
  }
}

module.exports = {
  saveFile,
  saveDepositProof,
  savePaymentMethodQr,
  saveSupportImage,
  saveGameImage,
  deleteFile,
  deleteDepositProof: fileName =>
    deleteStoredFile(fileName, depositUploadDirectory),
  deletePaymentMethodQr: fileName =>
    deleteStoredFile(fileName, paymentMethodUploadDirectory),
  deleteSupportImage: fileName =>
    deleteStoredFile(fileName, supportUploadDirectory),
  deleteGameImage: fileName => deleteStoredFile(fileName, gameUploadDirectory),
  getFileUrl,
  getDepositProofUrl,
  getPaymentMethodQrUrl,
  getSupportImageUrl,
  getGameImageUrl,
  getFileContentType,
  readFile,
  readDepositProof: fileName =>
    readStoredFile(fileName, depositUploadDirectory),
  readPaymentMethodQr: fileName =>
    readStoredFile(fileName, paymentMethodUploadDirectory),
  readSupportImage: fileName =>
    readStoredFile(fileName, supportUploadDirectory),
  readGameImage: fileName => readStoredFile(fileName, gameUploadDirectory),
  validateImageFile,
};
