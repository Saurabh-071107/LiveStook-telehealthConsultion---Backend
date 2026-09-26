const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');

const config = require('./config');
const db = require('./db');

// Route imports
const authRoutes = require('./routes/auth');
const animalRoutes = require('./routes/animals');
const caseRoutes = require('./routes/cases');
const vetRoutes = require('./routes/vets');
const appointmentRoutes = require('./routes/appointments');
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

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ensure upload directory exists
if (!fs.existsSync(config.uploadDir)) {
  fs.mkdirSync(config.uploadDir, { recursive: true });
}
app.use('/uploads', express.static(config.uploadDir));

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
