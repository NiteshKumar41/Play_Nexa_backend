const mongoose = require("mongoose");

const REQUIRED_INDEXES = [
  {
    collection: "users",
    name: "user_referralCode_unique",
    key: { referralCode: 1 },
    options: { unique: true, sparse: true },
  },
  {
    collection: "users",
    name: "referredBy_1",
    key: { referredBy: 1 },
    options: {},
  },
  {
    collection: "wallettransactions",
    name: "walletTransaction_referralReward_match_unique",
    key: { transactionType: 1, referenceType: 1, referenceId: 1 },
    options: {
      unique: true,
      partialFilterExpression: {
        transactionType: "REFERRAL_REWARD",
        referenceType: "REFERRAL_REWARD",
        status: "SUCCESS",
      },
    },
  },
  {
    collection: "platformcommissions",
    name: "matchId_1",
    key: { matchId: 1 },
    options: { unique: true },
  },
  {
    collection: "platformcommissions",
    name: "settlementReference_1",
    key: { settlementReference: 1 },
    options: { unique: true },
  },
];

const DUPLICATE_CHECKS = [
  {
    name: "duplicateReferralCodes",
    collection: "users",
    match: {
      referralCode: { $exists: true, $ne: null, $type: "string" },
    },
    group: "$referralCode",
  },
  {
    name: "duplicateReferralRewards",
    collection: "wallettransactions",
    match: {
      transactionType: "REFERRAL_REWARD",
      referenceType: "REFERRAL_REWARD",
      status: "SUCCESS",
    },
    group: {
      transactionType: "$transactionType",
      referenceType: "$referenceType",
      referenceId: "$referenceId",
    },
  },
  {
    name: "duplicatePlatformCommissionMatches",
    collection: "platformcommissions",
    match: {},
    group: "$matchId",
  },
  {
    name: "duplicatePlatformCommissionReferences",
    collection: "platformcommissions",
    match: {},
    group: "$settlementReference",
  },
];

function parseArguments(argumentsList) {
  const apply = argumentsList.includes("--apply");
  const verify = argumentsList.includes("--verify");
  const allowProduction = argumentsList.includes("--allow-production");
  const databaseArgument = argumentsList.find(argument =>
    argument.startsWith("--database-name=")
  );

  if (apply === verify) {
    throw new Error("Choose exactly one of --verify or --apply");
  }

  return {
    apply,
    allowProduction,
    databaseName: databaseArgument?.slice("--database-name=".length) || null,
  };
}

function stableJson(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return JSON.stringify(value ?? null);
  }

  return JSON.stringify(
    Object.keys(value)
      .sort()
      .reduce((sorted, key) => {
        sorted[key] = value[key];
        return sorted;
      }, {})
  );
}

function indexMatches(actualIndex, requiredIndex) {
  const actualUnique = Boolean(actualIndex.unique);
  const actualSparse = Boolean(actualIndex.sparse);
  const requiredUnique = Boolean(requiredIndex.options.unique);
  const requiredSparse = Boolean(requiredIndex.options.sparse);
  const actualPartial = actualIndex.partialFilterExpression || null;
  const requiredPartial = requiredIndex.options.partialFilterExpression || null;

  return (
    stableJson(actualIndex.key) === stableJson(requiredIndex.key) &&
    actualUnique === requiredUnique &&
    actualSparse === requiredSparse &&
    stableJson(actualPartial) === stableJson(requiredPartial)
  );
}

async function getIndexes(db, collectionName) {
  try {
    return await db.collection(collectionName).listIndexes().toArray();
  } catch (error) {
    if (error.code === 26 || error.codeName === "NamespaceNotFound") return [];
    throw error;
  }
}

async function findDuplicateGroupCount(db, definition) {
  const result = await db
    .collection(definition.collection)
    .aggregate([
      { $match: definition.match },
      { $group: { _id: definition.group, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $count: "duplicateGroups" },
    ])
    .toArray();

  return result[0]?.duplicateGroups || 0;
}

async function preflightDuplicates(db) {
  const duplicateGroups = {};
  for (const definition of DUPLICATE_CHECKS) {
    duplicateGroups[definition.name] = await findDuplicateGroupCount(
      db,
      definition
    );
  }
  return duplicateGroups;
}

async function verifyTransactionSupport(db) {
  const session = await mongoose.startSession();
  try {
    // This is a read-only transaction capability check. It does not insert,
    // update, delete, or alter financial data.
    await session.withTransaction(async () => {
      await db.collection("users").findOne(
        {},
        { projection: { _id: 1 }, session }
      );
    });
    return true;
  } finally {
    await session.endSession();
  }
}

async function inspectIndexes(db) {
  const indexesByCollection = new Map();
  for (const requiredIndex of REQUIRED_INDEXES) {
    if (!indexesByCollection.has(requiredIndex.collection)) {
      indexesByCollection.set(
        requiredIndex.collection,
        await getIndexes(db, requiredIndex.collection)
      );
    }
  }

  return REQUIRED_INDEXES.map(requiredIndex => {
    const indexes = indexesByCollection.get(requiredIndex.collection) || [];
    const exactKeyIndexes = indexes.filter(index =>
      stableJson(index.key) === stableJson(requiredIndex.key)
    );
    const matchingIndex = exactKeyIndexes.find(index =>
      indexMatches(index, requiredIndex)
    );

    return {
      collection: requiredIndex.collection,
      name: requiredIndex.name,
      present: Boolean(matchingIndex),
      conflicting: exactKeyIndexes.some(index => !indexMatches(index, requiredIndex)),
    };
  });
}

async function connect() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error("MONGODB_URI or MONGO_URI is required");
  await mongoose.connect(uri, { autoIndex: false });
}

async function main(argumentsList = process.argv.slice(2)) {
  const options = parseArguments(argumentsList);
  const uriDatabaseName = process.env.MONGODB_DATABASE_NAME || null;

  if (options.apply) {
    if (!options.databaseName) {
      throw new Error("--database-name=<name> is required with --apply");
    }
    if (process.env.SETTLEMENT_INDEX_MIGRATION_CONFIRM !== options.databaseName) {
      throw new Error(
        "SETTLEMENT_INDEX_MIGRATION_CONFIRM must exactly match --database-name"
      );
    }
    if (process.env.NODE_ENV === "production" && !options.allowProduction) {
      throw new Error(
        "Production index changes require the explicit --allow-production flag"
      );
    }
  }

  await connect();
  try {
    const databaseName = mongoose.connection.name;
    if (options.databaseName && options.databaseName !== databaseName) {
      throw new Error("Connected database does not match --database-name");
    }
    if (uriDatabaseName && uriDatabaseName !== databaseName) {
      throw new Error("MONGODB_DATABASE_NAME does not match the connected database");
    }

    const transactionSupported = await verifyTransactionSupport(
      mongoose.connection.db
    );
    const duplicateGroups = await preflightDuplicates(mongoose.connection.db);
    const indexStatus = await inspectIndexes(mongoose.connection.db);
    const duplicateCount = Object.values(duplicateGroups).reduce(
      (total, count) => total + count,
      0
    );
    const conflicts = indexStatus.filter(index => index.conflicting);
    const missing = indexStatus.filter(index => !index.present);

    if (!transactionSupported) {
      throw new Error("MongoDB transaction capability check failed");
    }
    if (duplicateCount > 0) {
      throw new Error("Duplicate data preflight failed; no indexes were changed");
    }
    if (conflicts.length > 0) {
      throw new Error("Conflicting index definitions found; no indexes were changed");
    }

    if (options.apply) {
      for (const requiredIndex of REQUIRED_INDEXES) {
        const status = indexStatus.find(index => index.name === requiredIndex.name);
        if (!status?.present) {
          await mongoose.connection.db
            .collection(requiredIndex.collection)
            .createIndex(requiredIndex.key, {
              ...requiredIndex.options,
              name: requiredIndex.name,
            });
        }
      }
    }

    console.log(
      JSON.stringify(
        {
          mode: options.apply ? "apply" : "verify",
          database: databaseName,
          transactionSupported,
          duplicateGroups,
          indexes: options.apply
            ? await inspectIndexes(mongoose.connection.db)
            : indexStatus,
          changedIndexes: options.apply ? missing.length : 0,
        },
        null,
        2
      )
    );
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Settlement index operation failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  DUPLICATE_CHECKS,
  REQUIRED_INDEXES,
  indexMatches,
  parseArguments,
  preflightDuplicates,
};
