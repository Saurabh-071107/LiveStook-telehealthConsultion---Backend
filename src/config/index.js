const path = require('path');
const os = require('os');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

module.exports = {
  port: process.env.PORT || 5000,
  nodeEnv: process.env.NODE_ENV || 'production',
  jwtSecret: process.env.JWT_SECRET || 'pashuseva_super_secure_jwt_secret_2026_production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  mongoUri: process.env.MONGODB_URI || 'mongodb+srv://mathsaurabh7_db_user:vJOjGfiENr9qe0CC@cluster0.odug5oa.mongodb.net/pashuseva?retryWrites=true&w=majority',
  databasePath: isServerless
    ? path.join(os.tmpdir(), 'database.json')
    : path.resolve(__dirname, '../../', process.env.DATABASE_PATH || './data/database.json'),
  uploadDir: isServerless
    ? path.join(os.tmpdir(), 'uploads')
    : path.resolve(__dirname, '../../', process.env.UPLOAD_DIR || './uploads'),
  openWeatherApiKey: process.env.OPENWEATHER_API_KEY || '',
  weatherCacheTtlMinutes: parseInt(process.env.WEATHER_CACHE_TTL_MINUTES || '60', 10),
  agoraAppId: process.env.AGORA_APP_ID || '21d6374040604b4dbcc7307069709b25e',
  agoraAppCertificate: process.env.AGORA_APP_CERTIFICATE || '6478216e5249477c88a5cf3d116017f2',
  oneSignalAppId: process.env.ONESIGNAL_APP_ID || '',
  oneSignalRestApiKey: process.env.ONESIGNAL_REST_API_KEY || '',
  aiServiceUrl: process.env.AI_SERVICE_URL || 'https://pashu-seva-ai-service.onrender.com',
};

