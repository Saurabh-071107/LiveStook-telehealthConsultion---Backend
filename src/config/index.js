const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

module.exports = {
  port: process.env.PORT || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || 'pashuseva_dev_secret_key_2026_super_secure',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  mongoUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/pashuseva',
  databasePath: path.resolve(__dirname, '../../', process.env.DATABASE_PATH || './data/database.json'),
  uploadDir: path.resolve(__dirname, '../../', process.env.UPLOAD_DIR || './uploads'),
  openWeatherApiKey: process.env.OPENWEATHER_API_KEY || '',
  weatherCacheTtlMinutes: parseInt(process.env.WEATHER_CACHE_TTL_MINUTES || '60', 10),
  agoraAppId: process.env.AGORA_APP_ID || '',
  agoraAppCertificate: process.env.AGORA_APP_CERTIFICATE || '',
  oneSignalAppId: process.env.ONESIGNAL_APP_ID || '',
  oneSignalRestApiKey: process.env.ONESIGNAL_REST_API_KEY || '',
  aiServiceUrl: process.env.AI_SERVICE_URL || 'http://localhost:8000',
};
