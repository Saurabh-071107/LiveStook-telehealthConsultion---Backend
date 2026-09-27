let app;
let serverError = null;

try {
  const serverModule = require('../src/server');
  app = serverModule.app;
} catch (e) {
  serverError = e;
  console.error('[Module Load Error in Vercel Function]', e);
}

module.exports = async (req, res) => {
  if (serverError) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({
      error: 'Module Load Error',
      message: serverError.message,
      stack: serverError.stack
    }));
  }

  try {
    const { connectMongoDB, isConnected } = require('../src/db/mongo');
    if (!isConnected) {
      await connectMongoDB().catch(err => console.warn('[MongoDB Connect]', err.message));
    }
  } catch (dbErr) {
    console.warn('[MongoDB Setup Error]', dbErr.message);
  }

  return app(req, res);
};


