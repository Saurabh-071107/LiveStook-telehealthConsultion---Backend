const { app } = require('../src/server');
const { connectMongoDB } = require('../src/db/mongo');

let isConnected = false;

module.exports = async (req, res) => {
  if (!isConnected) {
    try {
      await connectMongoDB();
      isConnected = true;
    } catch (err) {
      console.warn('[MongoDB Serverless Connect Notice]', err.message);
    }
  }
  return app(req, res);
};
