const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');

const config = require('./config');
const db = require('./db');
const { connectMongoDB } = require('./db/mongo');
const cronScheduler = require('./jobs/cron');

// Route imports
const authRoutes = require('./routes/auth');
const animalRoutes = require('./routes/animals');
const caseRoutes = require('./routes/cases');
const vetRoutes = require('./routes/vets');
const appointmentRoutes = require('./routes/appointments');
const consultationRoutes = require('./routes/consultations');
const labRoutes = require('./routes/labs');
const weatherRoutes = require('./routes/weather');
const vaccinationRoutes = require('./routes/vaccinations');
const marketplaceRoutes = require('./routes/marketplace');
const outbreakRoutes = require('./routes/outbreaks');
const regulationRoutes = require('./routes/regulations');
const adminRoutes = require('./routes/admin');

const app = express();
const server = http.createServer(app);

// Real-time WebSocket server for Teleconsultations & Urgent Outbreak Broadcasts
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PATCH', 'DELETE']
  }
});
app.set('io', io);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ensure upload directory exists safely
try {
  if (!fs.existsSync(config.uploadDir)) {
    fs.mkdirSync(config.uploadDir, { recursive: true });
  }
} catch (err) {
  // Silent fallback for read-only serverless filesystems
}
app.use('/uploads', express.static(config.uploadDir));

// System Root Landing Page
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Pashu Seva Backend API</title>
        <style>
          body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; padding: 40px; }
          .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 24px; max-width: 600px; margin: 0 auto; }
          .badge { background: #059669; color: #fff; padding: 4px 10px; border-radius: 9999px; font-size: 12px; font-weight: bold; }
          a { color: #38bdf8; text-decoration: none; }
          a:hover { text-decoration: underline; }
          ul { line-height: 1.8; }
        </style>
      </head>
      <body>
        <div class="card">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <h2>Pashu Seva Veterinary Platform API</h2>
            <span class="badge">ONLINE</span>
          </div>
          <p style="color: #94a3b8; font-size: 14px;">Unified Veterinary Healthcare, Teleconsultation & Biosecurity Network</p>
          <hr style="border: 0; border-top: 1px solid #334155; margin: 16px 0;" />
          <p><strong>Available Diagnostic Endpoints:</strong></p>
          <ul>
            <li><a href="/health">/health</a> — System Healthcheck</li>
            <li><a href="/api/admin/stats">/api/admin/stats</a> — Realtime Surveillance KPIs</li>
            <li><a href="/api/outbreaks/surveillance-layers">/api/outbreaks/surveillance-layers</a> — 3-Layer GIS Map Data</li>
            <li><a href="/api/labs">/api/labs</a> — Diagnostic Laboratory Stations</li>
          </ul>
        </div>
      </body>
    </html>
  `);
});

// System Healthcheck
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'Pashu Seva Unified Veterinary & Surveillance API',
    timestamp: new Date().toISOString(),
    environment: config.nodeEnv
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/animals', animalRoutes);
app.use('/api/cases', caseRoutes);
app.use('/api/vets', vetRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/consultations', consultationRoutes);
app.use('/api/labs', labRoutes);
app.use('/api/weather', weatherRoutes);
app.use('/api/vaccinations', vaccinationRoutes);
app.use('/api/marketplace', marketplaceRoutes);
app.use('/api/outbreaks', outbreakRoutes);
app.use('/api/regulations', regulationRoutes);
app.use('/api/admin', adminRoutes);

// Socket.IO Events for Live Vet Calls & Emergency Push
io.on('connection', (socket) => {
  socket.on('join-room', (roomId) => {
    socket.join(roomId);
    socket.to(roomId).emit('user-joined', socket.id);
  });

  socket.on('call-signal', ({ roomId, signal }) => {
    socket.to(roomId).emit('call-signal', { signal, senderId: socket.id });
  });

  socket.on('leave-room', (roomId) => {
    socket.leave(roomId);
    socket.to(roomId).emit('user-left', socket.id);
  });

  socket.on('disconnect', () => {
    // clean up
  });
});

// Centralized Error Handling
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Malformed JSON payload provided.' });
  }
  console.error('Unhandled Server Error:', err);
  res.status(500).json({ error: 'Internal Server Error.' });
});

// Start Server
if (require.main === module) {
  // Connect MongoDB on boot
  connectMongoDB().catch(err => console.warn('[MongoDB Initial Notice]', err.message));

  // Launch background job scheduler
  cronScheduler.startAll();

  server.listen(config.port, () => {
    console.log(`=============================================================`);
    console.log(`   PASHU SEVA BACKEND API SERVER IS READY & RUNNING`);
    console.log(`   Port: http://localhost:${config.port}`);
    console.log(`   Environment: ${config.nodeEnv}`);
    console.log(`   Healthcheck: http://localhost:${config.port}/health`);
    console.log(`=============================================================`);
  });
}

module.exports = { app, server, io };
