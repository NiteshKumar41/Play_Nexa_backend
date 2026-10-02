const mongoose = require("mongoose");

async function connectDatabase() {
  try {
    await mongoose.connect(
      process.env.MONGODB_URI || process.env.MONGO_URI
    );

    console.log("MongoDB connected successfully");
  } catch (error) {
    console.error("MongoDB connection failed:", error.name);
    throw error;
  }
}

module.exports = connectDatabase;
