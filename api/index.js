const { app } = require('../src/server');
const { connectMongoDB } = require('../src/db/mongo');

let isConnected = false;

// Middleware to establish MongoDB Atlas connection before serving requests
app.use(async (req, res, next) => {
  if (!isConnected) {
    try {
      await connectMongoDB();
      isConnected = true;
    } catch (err) {
      console.warn('[MongoDB Serverless Connect Notice]', err.message);
    }
  }
  next();
});

module.exports = app;

