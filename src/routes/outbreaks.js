const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const aiAnalyticsService = require('../services/aiAnalyticsService');
const { authenticate, requireRole } = require('../middleware/auth');

// GET /api/outbreaks (GIS Outbreak Dashboard & Alert Feed)
router.get('/', authenticate, (req, res) => {
  try {
    const { district, severity } = req.query;
    let list = db.findAll('outbreaks');
    if (district) list = list.filter(o => o.district.toLowerCase() === district.toLowerCase());
    if (severity) list = list.filter(o => o.severity.toLowerCase() === severity.toLowerCase());
    return res.json(list);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve outbreaks.' });
  }
});

// GET /api/outbreaks/clusters (Dynamic GIS cluster scan from reported cases)
router.get('/clusters', authenticate, (req, res) => {
  try {
    const cases = db.findAll('cases');
    const clusters = aiAnalyticsService.detectClusters(cases, db.calculateDistanceKm);
    return res.json(clusters);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to compute GIS clusters.' });
  }
});

// POST /api/outbreaks (Vet or Admin reports / confirms an outbreak)
router.post('/', authenticate, requireRole('vet', 'government_admin'), (req, res) => {
  try {
    const { disease, severity, clusterRadiusKm, epicenter, district, state, casesCount, description, containmentMeasures } = req.body;

    if (!disease || !epicenter) {
      return res.status(400).json({ error: 'Disease name and epicenter coordinates are required.' });
    }

    const newOutbreak = {
      id: `outbreak-${uuidv4().substring(0, 8)}`,
      disease,
      severity: severity || 'High',
      clusterRadiusKm: Number(clusterRadiusKm) || 15,
      epicenter,
      district: district || req.user.district || 'Pune',
      state: state || req.user.state || 'Maharashtra',
      casesCount: Number(casesCount) || 1,
      suspectedHerdsCount: Math.ceil((Number(casesCount) || 1) * 0.6),
      status: 'Active Containment Zone',
      quarantineActive: true,
      reportedByVetId: req.user.role === 'vet' ? req.user.id : null,
      description: description || 'Suspected outbreak cluster reported by field veterinary team.',
      containmentMeasures: containmentMeasures || [
        'Immediate quarantine perimeter established',
        'Emergency ring vaccination protocol activated'
      ],
      createdAt: new Date().toISOString()
    };

    db.create('outbreaks', newOutbreak);

    // Auto-create broadcast alert for farmers in district
    const broadcast = {
      id: `bcast-${uuidv4().substring(0, 8)}`,
      title: `URGENT: ${newOutbreak.disease} Alert in ${newOutbreak.district}`,
      message: `Quarantine buffer of ${newOutbreak.clusterRadiusKm} km active. Inspect herds for symptoms. Call 1962 or your local vet dispensary immediately.`,
      targetDistrict: newOutbreak.district,
      targetAudience: 'Farmers & Veterinarians',
      urgency: 'Immediate',
      sentAt: new Date().toISOString()
    };
    db.create('broadcasts', broadcast);

    return res.status(201).json({ outbreak: newOutbreak, broadcast });
  } catch (err) {
    console.error('Error reporting outbreak:', err);
    return res.status(500).json({ error: 'Failed to record outbreak.' });
  }
});

// POST /api/outbreaks/broadcast (Govt Admin broadcasts warning)
router.post('/broadcast', authenticate, requireRole('government_admin'), (req, res) => {
  try {
    const { title, message, targetDistrict, targetAudience, urgency } = req.body;
    if (!title || !message) {
      return res.status(400).json({ error: 'Title and message are required.' });
    }

    const broadcast = {
      id: `bcast-${uuidv4().substring(0, 8)}`,
      title,
      message,
      targetDistrict: targetDistrict || 'All',
      targetAudience: targetAudience || 'Farmers & Veterinarians',
      urgency: urgency || 'Immediate',
      sentAt: new Date().toISOString()
    };

    db.create('broadcasts', broadcast);
    return res.status(201).json(broadcast);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to dispatch broadcast.' });
  }
});

// GET /api/outbreaks/broadcasts
router.get('/broadcasts', authenticate, (req, res) => {
  try {
    const broadcasts = db.findAll('broadcasts');
    return res.json(broadcasts);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch broadcasts.' });
  }
});

module.exports = router;
