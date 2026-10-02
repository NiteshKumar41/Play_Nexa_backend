const mongoose = require("mongoose");
const SupportTicket = require("../models/SupportTicket");
const User = require("../models/User");
const WalletTransaction = require("../models/WalletTransaction");
const dateUtils = require("../utils/date");
const fileStorage = require("../utils/fileStorage");

const TICKET_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"];

function createSupportError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function validateObjectId(value, label) {
  if (!mongoose.isValidObjectId(value)) {
    throw createSupportError(`Invalid ${label}`, 400);
  }
}

function validatePagination(pageValue, limitValue) {
  const page = Number(pageValue ?? 1);
  const limit = Number(limitValue ?? 20);
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    throw createSupportError("Page must be positive and limit must be 1-100", 400);
  }
  return { page, limit };
}

function validateStatus(status) {
  if (status && !TICKET_STATUSES.includes(status)) {
    throw createSupportError("Invalid ticket status", 400);
  }
}

function getDateRange(query) {
  return dateUtils.getISTDateRange(query.from, query.to);
}

function normalizeText(value, label, minimum, maximum) {
  if (typeof value !== "string") {
    throw createSupportError(`${label} is required`, 400);
  }
  const trimmedValue = value.trim();
  if (trimmedValue.length < minimum || trimmedValue.length > maximum) {
    throw createSupportError(
      `${label} must be between ${minimum} and ${maximum} characters`,
      400
    );
  }
  return trimmedValue;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatPlayerTicket(ticket) {
  return {
    ticketId: ticket._id.toString(),
    subject: ticket.subject,
    description: ticket.description,
    transactionId: ticket.transactionId?.toString() || null,
    imageUrl: ticket.imageUrl,
    status: ticket.status,
    resolution: ticket.resolution,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    resolvedAt: ticket.resolvedAt,
    closedAt: ticket.closedAt,
  };
}

function formatAdminTicket(ticket, user) {
  return {
    ...formatPlayerTicket(ticket),
    user: user
      ? {
          id: user._id.toString(),
          name: user.fullName,
          phone: user.phone,
          email: user.email || null,
        }
      : null,
    assignedTo: ticket.assignedTo?.toString() || null,
    resolvedBy: ticket.resolvedBy?.toString() || null,
  };
}

async function createTicket(userId, ticketData, imageFile) {
  validateObjectId(userId, "user");
  if (
    !ticketData ||
    typeof ticketData !== "object" ||
    Array.isArray(ticketData)
  ) {
    throw createSupportError("Ticket details are required", 400);
  }
  const allowedFields = [
    "subject",
    "description",
    "transactionId",
    "image",
  ];
  if (Object.keys(ticketData).some(field => !allowedFields.includes(field))) {
    throw createSupportError("Ticket request contains unsupported fields", 400);
  }

  const subject = normalizeText(ticketData.subject, "Subject", 3, 150);
  const description = normalizeText(
    ticketData.description,
    "Description",
    10,
    2000
  );
  let transactionId = null;
  if (ticketData.transactionId !== undefined && ticketData.transactionId !== "") {
    validateObjectId(ticketData.transactionId, "transaction ID");
    const transaction = await WalletTransaction.findOne({
      _id: ticketData.transactionId,
      userId,
    })
      .select("_id")
      .lean();
    if (!transaction) {
      throw createSupportError("Transaction not found", 404);
    }
    transactionId = transaction._id;
  }

  let imageFileName;
  try {
    if (imageFile) imageFileName = await fileStorage.saveSupportImage(imageFile);
    const ticketId = new mongoose.Types.ObjectId();
    const [ticket] = await SupportTicket.create([
      {
        _id: ticketId,
        userId,
        transactionId,
        subject,
        description,
        imageUrl: imageFileName
          ? fileStorage.getSupportImageUrl(ticketId, imageFileName)
          : null,
        status: "OPEN",
      },
    ]);
    return {
      ticketId: ticket._id.toString(),
      userId: ticket.userId.toString(),
      subject: ticket.subject,
      status: ticket.status,
      createdAt: ticket.createdAt,
    };
  } catch (error) {
    if (imageFileName) await fileStorage.deleteSupportImage(imageFileName);
    throw error;
  }
}

async function getUserTickets(userId, query) {
  validateObjectId(userId, "user");
  const { page, limit } = validatePagination(query.page, query.limit);
  validateStatus(query.status);
  const filter = { userId };
  if (query.status) filter.status = query.status;
  const dateRange = getDateRange(query);
  if (dateRange) filter.createdAt = dateRange;

  const [tickets, total] = await Promise.all([
    SupportTicket.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    SupportTicket.countDocuments(filter),
  ]);
  return {
    tickets: tickets.map(formatPlayerTicket),
    pagination: {
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    },
  };
}

async function getUserTicket(ticketId, userId) {
  validateObjectId(ticketId, "ticket ID");
  validateObjectId(userId, "user");
  const ticket = await SupportTicket.findOne({
    _id: ticketId,
    userId,
  }).lean();
  if (!ticket) throw createSupportError("Ticket not found", 404);
  return formatPlayerTicket(ticket);
}

async function getAdminTickets(query) {
  const { page, limit } = validatePagination(query.page, query.limit);
  validateStatus(query.status);
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.userId) {
    validateObjectId(query.userId, "user ID");
    filter.userId = query.userId;
  }
  const dateRange = getDateRange(query);
  if (dateRange) filter.createdAt = dateRange;

  if (query.search !== undefined) {
    if (typeof query.search !== "string" || query.search.trim().length > 150) {
      throw createSupportError("Search must be 150 characters or fewer", 400);
    }
    const search = escapeRegex(query.search.trim());
    if (search) {
      const [users, matchingTransaction] = await Promise.all([
        User.find({
          $or: [
            { fullName: { $regex: search, $options: "i" } },
            { phone: { $regex: search, $options: "i" } },
          ],
        })
          .select("_id")
          .limit(501)
          .lean(),
        mongoose.isValidObjectId(query.search.trim())
          ? WalletTransaction.findById(query.search.trim())
              .select("_id")
              .lean()
          : [],
      ]);

      const searchConditions = [
        { subject: { $regex: search, $options: "i" } },
      ];
      if (mongoose.isValidObjectId(query.search.trim())) {
        searchConditions.push({ _id: query.search.trim() });
        searchConditions.push({ transactionId: query.search.trim() });
      }
      if (users.length) {
        searchConditions.push({
          userId: { $in: users.map(user => user._id) },
        });
      }
      if (matchingTransaction) {
        searchConditions.push({ transactionId: matchingTransaction._id });
      }
      filter.$or = searchConditions;
    }
  }

  const [tickets, total] = await Promise.all([
    SupportTicket.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("userId", "_id fullName phone email")
      .lean(),
    SupportTicket.countDocuments(filter),
  ]);
  return {
    tickets: tickets.map(ticket =>
      formatAdminTicket(
        ticket,
        ticket.userId && typeof ticket.userId === "object"
          ? ticket.userId
          : null
      )
    ),
    pagination: {
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    },
  };
}

async function getTicketById(ticketId) {
  validateObjectId(ticketId, "ticket ID");
  const ticket = await SupportTicket.findById(ticketId)
    .populate("userId", "_id fullName phone email")
    .populate("assignedTo", "_id fullName phone")
    .populate("resolvedBy", "_id fullName phone")
    .lean();
  if (!ticket) throw createSupportError("Ticket not found", 404);

  let transaction = null;
  if (ticket.transactionId) {
    transaction = await WalletTransaction.findById(ticket.transactionId)
      .select("_id transactionType amount status createdAt")
      .lean();
  }

  const formattedTicket = formatAdminTicket(ticket, ticket.userId);
  formattedTicket.assignedTo = ticket.assignedTo
    ? {
        id: ticket.assignedTo._id.toString(),
        name: ticket.assignedTo.fullName,
        phone: ticket.assignedTo.phone,
      }
    : null;
  formattedTicket.resolvedBy = ticket.resolvedBy
    ? {
        id: ticket.resolvedBy._id.toString(),
        name: ticket.resolvedBy.fullName,
        phone: ticket.resolvedBy.phone,
      }
    : null;
  formattedTicket.transaction = transaction
    ? {
        id: transaction._id.toString(),
        transactionType: transaction.transactionType,
        amount: transaction.amount,
        status: transaction.status,
        createdAt: transaction.createdAt,
      }
    : null;
  return formattedTicket;
}

async function updateTicketStatus(ticketId, status) {
  validateObjectId(ticketId, "ticket ID");
  validateStatus(status);
  if (status !== "IN_PROGRESS") {
    throw createSupportError(
      "Use the resolve, close, or reopen endpoint for this status",
      400
    );
  }

  const ticket = await SupportTicket.findOneAndUpdate(
    { _id: ticketId, status: "OPEN" },
    { $set: { status: "IN_PROGRESS" } },
    { new: true, runValidators: true }
  );
  if (ticket) {
    return {
      ticketId: ticket._id.toString(),
      userId: ticket.userId.toString(),
      status: ticket.status,
    };
  }
  const existing = await SupportTicket.findById(ticketId).select("status");
  if (!existing) throw createSupportError("Ticket not found", 404);
  throw createSupportError(
    "Ticket can only move from OPEN to IN_PROGRESS",
    409
  );
}

async function resolveTicket(ticketId, adminId, resolution) {
  validateObjectId(ticketId, "ticket ID");
  validateObjectId(adminId, "admin");
  const normalizedResolution = normalizeText(
    resolution,
    "Resolution",
    5,
    2000
  );
  const resolvedAt = new Date();
  const ticket = await SupportTicket.findOneAndUpdate(
    { _id: ticketId, status: { $in: ["OPEN", "IN_PROGRESS"] } },
    {
      $set: {
        status: "RESOLVED",
        resolution: normalizedResolution,
        resolvedBy: adminId,
        resolvedAt,
      },
    },
    { new: true, runValidators: true }
  );
  if (ticket) {
    return {
      ticketId: ticket._id.toString(),
      userId: ticket.userId.toString(),
      status: ticket.status,
    };
  }
  const existing = await SupportTicket.findById(ticketId).select("status");
  if (!existing) throw createSupportError("Ticket not found", 404);
  throw createSupportError(
    "Only OPEN or IN_PROGRESS tickets can be resolved",
    409
  );
}

async function closeTicket(ticketId) {
  validateObjectId(ticketId, "ticket ID");
  const existing = await SupportTicket.findById(ticketId).select(
    "status resolution"
  );
  if (!existing) throw createSupportError("Ticket not found", 404);
  if (!existing.resolution?.trim()) {
    throw createSupportError("Ticket must be resolved before closing", 400);
  }
  if (existing.status !== "RESOLVED") {
    throw createSupportError("Only RESOLVED tickets can be closed", 409);
  }

  const ticket = await SupportTicket.findOneAndUpdate(
    {
      _id: ticketId,
      status: "RESOLVED",
      resolution: { $type: "string", $ne: "" },
    },
    { $set: { status: "CLOSED", closedAt: new Date() } },
    { new: true, runValidators: true }
  );
  if (!ticket) throw createSupportError("Ticket has already changed state", 409);
  return {
    ticketId: ticket._id.toString(),
    userId: ticket.userId.toString(),
    status: ticket.status,
  };
}

async function reopenTicket(ticketId) {
  validateObjectId(ticketId, "ticket ID");
  const ticket = await SupportTicket.findOneAndUpdate(
    { _id: ticketId, status: "CLOSED" },
    { $set: { status: "OPEN" } },
    { new: true, runValidators: true }
  );
  if (ticket) {
    return {
      ticketId: ticket._id.toString(),
      userId: ticket.userId.toString(),
      status: ticket.status,
    };
  }
  const existing = await SupportTicket.findById(ticketId).select("status");
  if (!existing) throw createSupportError("Ticket not found", 404);
  throw createSupportError("Only CLOSED tickets can be reopened", 409);
}

async function assignTicket(ticketId, adminId) {
  validateObjectId(ticketId, "ticket ID");
  validateObjectId(adminId, "admin ID");
  const selectedAdmin = await User.findOne({
    _id: adminId,
    role: "admin",
    active: true,
    isBlocked: false,
  })
    .select("_id")
    .lean();
  if (!selectedAdmin) throw createSupportError("Admin not found", 404);

  const ticket = await SupportTicket.findOneAndUpdate(
    { _id: ticketId, status: { $in: ["OPEN", "IN_PROGRESS"] } },
    { $set: { assignedTo: adminId } },
    { new: true, runValidators: true }
  );
  if (ticket) {
    return {
      ticketId: ticket._id.toString(),
      userId: ticket.userId.toString(),
      status: ticket.status,
    };
  }
  const existing = await SupportTicket.findById(ticketId).select("status");
  if (!existing) throw createSupportError("Ticket not found", 404);
  throw createSupportError("Closed tickets cannot be assigned", 409);
}

async function getTicketImage(ticketId, fileName, userId, role) {
  validateObjectId(ticketId, "ticket ID");
  validateObjectId(userId, "user");
  const filter = { _id: ticketId };
  if (role !== "admin") filter.userId = userId;
  const ticket = await SupportTicket.findOne(filter).select("imageUrl").lean();
  if (!ticket) throw createSupportError("Ticket not found", 404);
  if (ticket.imageUrl !== fileStorage.getSupportImageUrl(ticketId, fileName)) {
    throw createSupportError("Ticket image not found", 404);
  }
  return {
    buffer: await fileStorage.readSupportImage(fileName),
    contentType: fileStorage.getFileContentType(fileName),
  };
}

module.exports = {
  createTicket,
  getUserTickets,
  getUserTicket,
  getAdminTickets,
  getTicketById,
  updateTicketStatus,
  resolveTicket,
  closeTicket,
  reopenTicket,
  assignTicket,
  getTicketImage,
};
