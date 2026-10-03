"use strict";

const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const mongoose = require("mongoose");

const BACKEND_ROOT = path.resolve(__dirname, "..");
const REPORT_DIRECTORY = path.join(__dirname, "reports");
const REPORT_PATH = path.join(
  REPORT_DIRECTORY,
  "walletTransactionMigrationReport.json"
);

// Load the same backend .env file used by the application, without validating
// unrelated server settings such as PORT, JWT_SECRET, or CLIENT_URL.
dotenv.config({ path: path.join(BACKEND_ROOT, ".env") });

const LEGACY_INDEX_NAMES = [
  "userId_1_transactionType_1_clientRequestId_1",
  "transactionType_1_referenceType_1_referenceId_1",
  "providerRefundId_1",
  "userId_1_transactionType_1_upiTransactionId_1",
  "userId_1_transactionType_1_referenceType_1_referenceId_1",
];

const HISTORICAL_TRANSACTION_TYPES = [
  "GAME_CREATE",
  "GAME_JOIN",
  "GAME_REFUND",
  "GAME_WIN",
];

const TRANSACTION_FIELDS = [
  "_id",
  "userId",
  "amount",
  "status",
  "transactionType",
  "referenceType",
  "referenceId",
  "createdAt",
  "originalTransactionId",
];

function serializeValue(value) {
  if (value === undefined) return null;
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof mongoose.Types.ObjectId) return value.toString();
  if (Buffer.isBuffer(value)) return value.toString("base64");
  if (Array.isArray(value)) return value.map(serializeValue);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [
        key,
        serializeValue(entryValue),
      ])
    );
  }
  return value;
}

function idString(value) {
  if (value === undefined || value === null || value === "") return null;
  return value.toString();
}

function amountsMatch(left, right) {
  return (
    typeof left === "number" &&
    Number.isFinite(left) &&
    typeof right === "number" &&
    Number.isFinite(right) &&
    left === right
  );
}

function transactionSummary(transaction) {
  return {
    transactionId: idString(transaction._id),
    userId: idString(transaction.userId),
    amount: transaction.amount ?? null,
    status: transaction.status ?? null,
    transactionType: transaction.transactionType ?? null,
    referenceType: transaction.referenceType ?? null,
    referenceId: transaction.referenceId ?? null,
    createdAt: serializeValue(transaction.createdAt),
  };
}

function addToMap(map, key, value) {
  if (!key) return;
  const values = map.get(key) || [];
  values.push(value);
  map.set(key, values);
}

function addCandidate(candidateMap, match, source) {
  if (!match) return;
  const matchId = idString(match._id);
  if (!matchId) return;

  const existing = candidateMap.get(matchId) || {
    match,
    sources: [],
  };
  if (!existing.sources.includes(source)) existing.sources.push(source);
  candidateMap.set(matchId, existing);
}

function entryProjection() {
  return {
    transactionId: "$_id",
    userId: "$userId",
    amount: "$amount",
    status: "$status",
    transactionType: "$transactionType",
    referenceType: "$referenceType",
    referenceId: "$referenceId",
    createdAt: "$createdAt",
  };
}

async function findDuplicateGroups(WalletTransaction, definition) {
  const transactionProjection = entryProjection();
  const groupKey = Object.fromEntries(
    definition.groupFields.map(field => [field, `$${field}`])
  );

  const rows = await WalletTransaction.aggregate([
    { $match: definition.filter },
    {
      $group: {
        _id: groupKey,
        count: { $sum: 1 },
        transactions: { $push: transactionProjection },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } },
  ]).allowDiskUse(true);

  return rows.map(row => ({
    scope: definition.scope,
    groupingFields: definition.groupFields,
    groupingKey: serializeValue(row._id),
    count: row.count,
    transactions: row.transactions.map(serializeValue),
  }));
}

function indexReport(indexes) {
  const current = indexes.map(serializeValue);
  const byName = new Map(indexes.map(index => [index.name, index]));
  const legacyConflicting = LEGACY_INDEX_NAMES.map(name => ({
    name,
    exists: byName.has(name),
    definition: byName.has(name) ? serializeValue(byName.get(name)) : null,
  }));

  return { current, legacyConflicting };
}

function buildMatchIndexes(matches) {
  const matchById = new Map();
  const matchByPlayer1EntryId = new Map();
  const matchByPlayer2EntryId = new Map();
  const matchBySettlementTransactionId = new Map();

  for (const match of matches) {
    const matchId = idString(match._id);
    if (!matchId) continue;
    matchById.set(matchId, match);
    addToMap(
      matchByPlayer1EntryId,
      idString(match.walletTransactionIdPlayer1),
      match
    );
    addToMap(
      matchByPlayer2EntryId,
      idString(match.walletTransactionIdPlayer2),
      match
    );
    addToMap(
      matchBySettlementTransactionId,
      idString(match.winnerTransactionId),
      match
    );
    for (const transactionId of match.settlementWalletTransactionIds || []) {
      addToMap(matchBySettlementTransactionId, idString(transactionId), match);
    }
  }

  return {
    matchById,
    matchByPlayer1EntryId,
    matchByPlayer2EntryId,
    matchBySettlementTransactionId,
  };
}

function entryCandidates(transaction, role, matchIndexes) {
  const candidates = new Map();
  const referenceMatch = matchIndexes.matchById.get(
    idString(transaction.referenceId)
  );
  addCandidate(candidates, referenceMatch, "transaction.referenceId");

  const pointerMatches =
    role === "player1"
      ? matchIndexes.matchByPlayer1EntryId.get(idString(transaction._id))
      : matchIndexes.matchByPlayer2EntryId.get(idString(transaction._id));
  for (const match of pointerMatches || []) {
    addCandidate(candidates, match, `match.walletTransactionId${role === "player1" ? "Player1" : "Player2"}`);
  }

  return [...candidates.values()];
}

function evaluateEntryCandidate(transaction, candidate, role) {
  const match = candidate.match;
  const matchId = idString(match._id);
  const pointerField =
    role === "player1"
      ? "walletTransactionIdPlayer1"
      : "walletTransactionIdPlayer2";
  const userField = role === "player1" ? "player1" : "player2";
  const amountField = role === "player1" ? "player1Amount" : "player2Amount";
  const pointerId = idString(match[pointerField]);
  const pointerState =
    pointerId === idString(transaction._id)
      ? "MATCH"
      : pointerId
        ? "MISMATCH"
        : "MISSING";
  const checks = {
    walletTransactionIdMatches: pointerState === "MATCH",
    userMatches: idString(transaction.userId) === idString(match[userField]),
    amountMatches: amountsMatch(transaction.amount, match[amountField]),
    transactionSuccess: transaction.status === "SUCCESS",
    transactionTypeMatches: transaction.transactionType ===
      (role === "player1" ? "GAME_CREATE" : "GAME_JOIN"),
    referenceTypeMatches: transaction.referenceType === "MATCH",
    referenceIdMatches: idString(transaction.referenceId) === matchId,
  };
  const allChecksPass = Object.values(checks).every(Boolean);
  const safeForBackfill =
    allChecksPass && pointerState !== "MISMATCH";

  return {
    matchId,
    sources: candidate.sources,
    pointerField,
    pointerState,
    checks,
    safeForBackfill,
  };
}

function auditEntryTransaction(transaction, role, matchIndexes) {
  const candidates = entryCandidates(transaction, role, matchIndexes);
  const evaluations = candidates.map(candidate =>
    evaluateEntryCandidate(transaction, candidate, role)
  );
  const safeEvaluations = evaluations.filter(evaluation => evaluation.safeForBackfill);
  const status =
    evaluations.length === 0
      ? "NO_MATCH"
      : evaluations.length === 1 && safeEvaluations.length === 1
        ? "SAFE_TO_BACKFILL"
        : "AMBIGUOUS";

  return {
    transaction: transactionSummary(transaction),
    status,
    candidates: evaluations,
  };
}

function refundCandidates(transaction, matchIndexes, transactionById) {
  const candidates = new Map();
  const addMatch = (match, source) => addCandidate(candidates, match, source);

  addMatch(
    matchIndexes.matchById.get(idString(transaction.referenceId)),
    "transaction.referenceId"
  );

  const originalId = idString(transaction.originalTransactionId);
  const originalTransaction = transactionById.get(originalId);
  if (originalTransaction) {
    addMatch(
      matchIndexes.matchById.get(idString(originalTransaction.referenceId)),
      "originalTransaction.referenceId"
    );
  }

  for (const match of [
    ...(matchIndexes.matchByPlayer1EntryId.get(originalId) || []),
    ...(matchIndexes.matchByPlayer2EntryId.get(originalId) || []),
  ]) {
    addMatch(match, "match.entryTransactionId");
  }

  return [...candidates.values()];
}

function evaluateRefundCandidate(transaction, candidate, transactionById) {
  const match = candidate.match;
  const matchId = idString(match._id);
  const playerRoles = [
    {
      role: "player1",
      userId: match.player1,
      amount: match.player1Amount,
      entryId: match.walletTransactionIdPlayer1,
      entryType: "GAME_CREATE",
    },
    {
      role: "player2",
      userId: match.player2,
      amount: match.player2Amount,
      entryId: match.walletTransactionIdPlayer2,
      entryType: "GAME_JOIN",
    },
  ];
  const transactionChecks = {
    transactionTypeMatches: transaction.transactionType === "GAME_REFUND",
    referenceTypeMatches: transaction.referenceType === "MATCH_REFUND",
    referenceIdMatches: idString(transaction.referenceId) === matchId,
    transactionSuccess: transaction.status === "SUCCESS",
  };
  const originalTransactionId = idString(transaction.originalTransactionId);

  const roleEvaluations = playerRoles
    .filter(role => role.userId && role.entryId)
    .map(role => {
      const entryTransaction = transactionById.get(idString(role.entryId));
      const entryChecks = {
        entryExists: Boolean(entryTransaction),
        entryTypeMatches: entryTransaction?.transactionType === role.entryType,
        entrySuccess: entryTransaction?.status === "SUCCESS",
        entryUserMatches:
          idString(entryTransaction?.userId) === idString(role.userId),
        entryAmountMatches: amountsMatch(
          entryTransaction?.amount,
          role.amount
        ),
        entryReferenceTypeMatches: entryTransaction?.referenceType === "MATCH",
        entryReferenceIdMatches:
          idString(entryTransaction?.referenceId) === matchId,
      };
      const originalIdCheck = originalTransactionId
        ? originalTransactionId === idString(role.entryId)
        : null;
      const checks = {
        userMatches: idString(transaction.userId) === idString(role.userId),
        amountMatches: amountsMatch(transaction.amount, role.amount),
        ...entryChecks,
        ...(originalIdCheck === null
          ? {}
          : { originalTransactionIdMatches: originalIdCheck }),
      };
      const entryIsConclusive = Object.values(entryChecks).every(Boolean);
      const safeRole =
        transactionChecks.transactionTypeMatches &&
        transactionChecks.referenceTypeMatches &&
        transactionChecks.referenceIdMatches &&
        transactionChecks.transactionSuccess &&
        checks.userMatches &&
        checks.amountMatches &&
        entryIsConclusive &&
        (originalIdCheck === null || originalIdCheck);

      return {
        role: role.role,
        entryTransactionId: idString(role.entryId),
        originalEntryTransaction: entryTransaction
          ? transactionSummary(entryTransaction)
          : null,
        checks,
        safeRole,
      };
    });

  return {
    matchId,
    sources: candidate.sources,
    transactionChecks,
    playerRoles: roleEvaluations,
    safePlayerRoles: roleEvaluations.filter(role => role.safeRole).map(role => role.role),
  };
}

function auditRefundTransaction(transaction, matchIndexes, transactionById) {
  const candidates = refundCandidates(transaction, matchIndexes, transactionById);
  const evaluations = candidates.map(candidate =>
    evaluateRefundCandidate(transaction, candidate, transactionById)
  );
  const safeEvaluations = evaluations.filter(
    evaluation => evaluation.safePlayerRoles.length === 1
  );
  const status =
    evaluations.length === 0
      ? "NO_MATCH"
      : evaluations.length === 1 && safeEvaluations.length === 1
        ? "SAFE_TO_BACKFILL"
        : "AMBIGUOUS";

  return {
    transaction: transactionSummary(transaction),
    status,
    candidates: evaluations,
  };
}

function winCandidates(transaction, matchIndexes) {
  const candidates = new Map();
  addCandidate(
    candidates,
    matchIndexes.matchById.get(idString(transaction.referenceId)),
    "transaction.referenceId"
  );
  for (const match of
    matchIndexes.matchBySettlementTransactionId.get(idString(transaction._id)) || []) {
    addCandidate(candidates, match, "winner/settlement transaction pointer");
  }
  return [...candidates.values()];
}

function evaluateWinCandidate(transaction, candidate) {
  const match = candidate.match;
  const matchId = idString(match._id);
  const settlementIds = (match.settlementWalletTransactionIds || []).map(idString);
  const checks = {
    winnerTransactionIdMatches:
      idString(match.winnerTransactionId) === idString(transaction._id),
    settlementWalletTransactionIdMatches: settlementIds.includes(
      idString(transaction._id)
    ),
    winnerUserMatches: idString(transaction.userId) === idString(match.winnerPlayer),
    amountMatches: amountsMatch(transaction.amount, match.winnerAmount),
    transactionTypeMatches: transaction.transactionType === "GAME_WIN",
    referenceTypeMatches: transaction.referenceType === "MATCH_SETTLEMENT",
    referenceIdMatches: idString(transaction.referenceId) === matchId,
    transactionSuccess: transaction.status === "SUCCESS",
  };

  return {
    matchId,
    sources: candidate.sources,
    checks,
    safeForBackfill:
      checks.winnerTransactionIdMatches &&
      checks.settlementWalletTransactionIdMatches &&
      Object.entries(checks)
        .filter(([key]) =>
          ![
            "winnerTransactionIdMatches",
            "settlementWalletTransactionIdMatches",
          ].includes(key)
        )
        .every(([, value]) => value),
  };
}

function auditWinTransaction(transaction, matchIndexes) {
  const candidates = winCandidates(transaction, matchIndexes);
  const evaluations = candidates.map(candidate =>
    evaluateWinCandidate(transaction, candidate)
  );
  const safeEvaluations = evaluations.filter(evaluation => evaluation.safeForBackfill);
  const status =
    evaluations.length === 0
      ? "NO_MATCH"
      : evaluations.length === 1 && safeEvaluations.length === 1
        ? "SAFE_TO_BACKFILL"
        : "AMBIGUOUS";

  return {
    transaction: transactionSummary(transaction),
    status,
    candidates: evaluations,
  };
}

function historicalSummary(historicalReconciliation) {
  const records = HISTORICAL_TRANSACTION_TYPES.flatMap(
    transactionType => historicalReconciliation[transactionType]
  );
  return {
    safeReconciliationCount: records.filter(
      record => record.status === "SAFE_TO_BACKFILL"
    ).length,
    ambiguousCount: records.filter(record => record.status === "AMBIGUOUS").length,
    noMatchCount: records.filter(record => record.status === "NO_MATCH").length,
  };
}

async function main() {
  // Match backend/src/config/database.js exactly: MONGODB_URI has priority,
  // while the legacy MONGO_URI remains supported by the running backend.
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (typeof mongoUri !== "string" || !mongoUri.trim()) {
    console.error(
      "MongoDB configuration is missing (MONGODB_URI or MONGO_URI). Audit stopped without connecting or changing MongoDB."
    );
    return false;
  }

  // Prevent model initialization from issuing createIndexes/createCollection.
  // This audit is intentionally limited to listIndexes() and read-only queries.
  mongoose.set("autoIndex", false);
  mongoose.set("autoCreate", false);

  const WalletTransaction = require("../src/models/WalletTransaction");
  const GameMatch = require("../src/models/GameMatch");

  try {
    await mongoose.connect(mongoUri.trim(), { autoIndex: false });

    const currentIndexes = await WalletTransaction.collection
      .listIndexes()
      .toArray();
    const indexes = indexReport(currentIndexes);

    console.log("Current WalletTransaction indexes (read-only listIndexes):");
    for (const index of indexes.current) {
      console.log(JSON.stringify(index, null, 2));
    }
    console.log("Legacy/conflicting index presence:");
    for (const legacyIndex of indexes.legacyConflicting) {
      console.log(JSON.stringify(legacyIndex));
    }

    const duplicateDefinitions = {
      addMoneyClientRequestId: {
        scope: "ADD_MONEY (userId, clientRequestId)",
        filter: {
          transactionType: "ADD_MONEY",
          clientRequestId: { $type: "string" },
        },
        groupFields: ["userId", "clientRequestId"],
      },
      withdrawClientRequestId: {
        scope: "WITHDRAW (userId, clientRequestId)",
        filter: {
          transactionType: "WITHDRAW",
          clientRequestId: { $type: "string" },
        },
        groupFields: ["userId", "clientRequestId"],
      },
      providerRefundId: {
        // The application schema names this refund transaction type
        // ADD_MONEY_REFUND; this is the effective providerRefundId scope.
        scope: "ADD_MONEY_REFUND (providerRefundId)",
        filter: {
          transactionType: "ADD_MONEY_REFUND",
          providerRefundId: { $type: "string" },
        },
        groupFields: ["providerRefundId"],
      },
      addMoneyUpiTransactionId: {
        scope: "ADD_MONEY (userId, upiTransactionId)",
        filter: {
          transactionType: "ADD_MONEY",
          upiTransactionId: { $type: "string" },
        },
        groupFields: ["userId", "upiTransactionId"],
      },
      gameWin: {
        scope: "GAME_WIN settlement reference",
        filter: {
          transactionType: "GAME_WIN",
          referenceType: "MATCH_SETTLEMENT",
          status: "SUCCESS",
        },
        groupFields: ["transactionType", "referenceType", "referenceId"],
      },
      gameRefund: {
        scope: "GAME_REFUND (userId, MATCH_REFUND referenceId)",
        filter: {
          transactionType: "GAME_REFUND",
          referenceType: "MATCH_REFUND",
          status: "SUCCESS",
        },
        groupFields: ["userId", "transactionType", "referenceType", "referenceId"],
      },
      withdrawRefund: {
        scope: "WITHDRAW_REFUND withdrawal reference",
        filter: {
          transactionType: "WITHDRAW_REFUND",
          referenceType: "WITHDRAWAL",
          status: "SUCCESS",
        },
        groupFields: ["transactionType", "referenceType", "referenceId"],
      },
    };

    const duplicateGroups = {};
    for (const [name, definition] of Object.entries(duplicateDefinitions)) {
      duplicateGroups[name] = await findDuplicateGroups(
        WalletTransaction,
        definition
      );
    }

    console.log("Duplicate groups (read-only):");
    console.log(JSON.stringify(duplicateGroups, null, 2));

    const [currentTransactionCount, historicalTransactions, matches] =
      await Promise.all([
        WalletTransaction.countDocuments({}),
        WalletTransaction.find({
          transactionType: { $in: HISTORICAL_TRANSACTION_TYPES },
        })
          .select(TRANSACTION_FIELDS.join(" "))
          .sort({ createdAt: 1, _id: 1 })
          .lean(),
        GameMatch.find({})
          .select(
            "_id player1 player1Amount walletTransactionIdPlayer1 player2 player2Amount walletTransactionIdPlayer2 winnerPlayer winnerAmount winnerTransactionId settlementWalletTransactionIds status createdAt"
          )
          .sort({ createdAt: 1, _id: 1 })
          .lean(),
      ]);

    const transactionById = new Map(
      historicalTransactions.map(transaction => [
        idString(transaction._id),
        transaction,
      ])
    );
    const matchIndexes = buildMatchIndexes(matches);
    const historicalReconciliation = {
      GAME_CREATE: historicalTransactions
        .filter(transaction => transaction.transactionType === "GAME_CREATE")
        .map(transaction =>
          auditEntryTransaction(transaction, "player1", matchIndexes)
        ),
      GAME_JOIN: historicalTransactions
        .filter(transaction => transaction.transactionType === "GAME_JOIN")
        .map(transaction =>
          auditEntryTransaction(transaction, "player2", matchIndexes)
        ),
      GAME_REFUND: historicalTransactions
        .filter(transaction => transaction.transactionType === "GAME_REFUND")
        .map(transaction =>
          auditRefundTransaction(transaction, matchIndexes, transactionById)
        ),
      GAME_WIN: historicalTransactions
        .filter(transaction => transaction.transactionType === "GAME_WIN")
        .map(transaction => auditWinTransaction(transaction, matchIndexes)),
    };

    const reconciliationCounts = historicalSummary(historicalReconciliation);
    const summary = {
      currentTransactionCount,
      gameCreateCount: historicalReconciliation.GAME_CREATE.length,
      gameJoinCount: historicalReconciliation.GAME_JOIN.length,
      gameRefundCount: historicalReconciliation.GAME_REFUND.length,
      gameWinCount: historicalReconciliation.GAME_WIN.length,
      safeReconciliationCount: reconciliationCounts.safeReconciliationCount,
      ambiguousCount: reconciliationCounts.ambiguousCount,
      noMatchCount: reconciliationCounts.noMatchCount,
      duplicateAddMoneyClientRequestIdGroups:
        duplicateGroups.addMoneyClientRequestId.length,
      duplicateWithdrawGroups: duplicateGroups.withdrawClientRequestId.length,
      duplicateProviderRefundGroups: duplicateGroups.providerRefundId.length,
      duplicateUpiGroups: duplicateGroups.addMoneyUpiTransactionId.length,
      duplicateGameWinGroups: duplicateGroups.gameWin.length,
      duplicateGameRefundGroups: duplicateGroups.gameRefund.length,
      duplicateWithdrawRefundGroups: duplicateGroups.withdrawRefund.length,
    };

    console.log("Historical reconciliation:");
    console.log(JSON.stringify(historicalReconciliation, null, 2));
    console.log("Audit summary:");
    console.log(JSON.stringify(summary, null, 2));

    const report = {
      generatedAt: new Date().toISOString(),
      // Database name is safe to report; credentials and the URI are never stored.
      database: mongoose.connection.name,
      indexes,
      duplicateGroups,
      historicalReconciliation,
      summary,
    };

    fs.mkdirSync(REPORT_DIRECTORY, { recursive: true });
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    console.log(`JSON report written to ${path.relative(BACKEND_ROOT, REPORT_PATH)}`);
    return true;
  } finally {
    await mongoose.disconnect();
  }
}

main()
  .then(completed => {
    if (!completed) process.exitCode = 1;
  })
  .catch(error => {
    // Do not print error objects because driver errors can contain connection
    // details. The report itself never contains environment secrets.
    const errorCode = error.code ? ` (${error.code})` : "";
    console.error(
      `Wallet transaction migration audit failed: ${error.name}${errorCode}`
    );
    process.exitCode = 1;
  });
