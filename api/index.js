const { app } = require('../src/server');
const { connectMongoDB, isConnected } = require('../src/db/mongo');

// Initialize MongoDB Atlas connection in background
if (!isConnected) {
  connectMongoDB().catch(err => console.warn('[MongoDB Connect Notice]', err.message));
}

app.use((req, res, next) => {
  if (!isConnected) {
    connectMongoDB().catch(err => console.warn('[MongoDB Connect Notice]', err.message));
  }
  next();
});

module.exports = app;



