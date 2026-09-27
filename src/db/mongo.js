const mongoose = require('mongoose');
const config = require('../config');

let isConnected = false;

async function connectMongoDB() {
  if (isConnected) return mongoose.connection;

  try {
    const opts = {
      serverSelectionTimeoutMS: 5000,
      autoIndex: true,
    };

    await mongoose.connect(config.mongoUri, opts);
    isConnected = true;
    console.log(`[MongoDB] Connected successfully to ${mongoose.connection.host}/${mongoose.connection.name}`);
    return mongoose.connection;
  } catch (err) {
    console.warn(`[MongoDB Warning] Could not connect to MongoDB at ${config.mongoUri}: ${err.message}`);
    console.warn('[MongoDB Warning] Operating in dual-mode fallback. Please update MONGODB_URI in Backend/.env if using MongoDB Atlas.');
    return null;
  }
}

mongoose.connection.on('disconnected', () => {
  isConnected = false;
  console.log('[MongoDB] Connection lost.');
});

mongoose.connection.on('reconnected', () => {
  isConnected = true;
  console.log('[MongoDB] Reconnected successfully.');
});

module.exports = {
  connectMongoDB,
  mongoose,
  get isConnected() {
    return isConnected;
  }
};
