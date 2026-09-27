const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const outbreakRiskEngine = require('../services/outbreak-risk.service');
const notificationService = require('../services/notification.service');

// GET /api/outbreaks (GIS Outbreak Dashboard & Alert Feed)
router.get('/', authenticate, (req, res) => {
  try {
    const { district, severity } = req.query;
    let list = db.findAll('outbreaks');
    if (district) list = list.filter(o => (o.district || '').toLowerCase() === district.toLowerCase());
    if (severity) list = list.filter(o => (o.severity || o.riskCategory || '').toLowerCase() === severity.toLowerCase());
    return res.json(list);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve outbreaks.' });
  }
});

// GET /api/outbreaks/surveillance-layers (3 Interactive GIS Layers for Admin & Vet)
// 1. OBSERVED_CASES
// 2. ENVIRONMENTAL_RISK
// 3. COMBINED_RISK
router.get('/surveillance-layers', authenticate, async (req, res) => {
  try {
    const layers = await outbreakRiskEngine.getSurveillanceMapLayers();
    return res.json(layers);
  } catch (err) {
    console.error('Surveillance layers error:', err);
    return res.status(500).json({ error: 'Failed to generate surveillance map layers.' });
  }
});

// POST /api/outbreaks/evaluate (Run automated outbreak risk engine)
router.post('/evaluate', authenticate, requireRole('government_admin', 'ADMIN', 'admin'), async (req, res) => {
  try {
    const results = await outbreakRiskEngine.evaluateAllDistricts();
    return res.json({
      success: true,
      message: 'Automated bi-modal outbreak risk evaluation completed.',
      outbreaks: results
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to evaluate outbreak risks.' });
  }
});

// GET /api/outbreaks/clusters (Dynamic GIS cluster scan from reported cases)
router.get('/clusters', authenticate, (req, res) => {
  try {
    const list = db.findAll('outbreaks');
    return res.json(list);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to compute GIS clusters.' });
  }
});

// POST /api/outbreaks (Admin or Vet notes a cluster)
router.post('/', authenticate, requireRole('vet', 'VETERINARIAN', 'government_admin', 'ADMIN'), (req, res) => {
  try {
    const { disease, diseaseCategory, severity, clusterRadiusKm, epicenter, location, district, state, casesCount, description, containmentMeasures } = req.body;

    const resolvedDisease = disease || diseaseCategory;
    if (!resolvedDisease) {
      return res.status(400).json({ error: 'Disease name is required.' });
    }

    const newOutbreak = {
      id: `outbreak-${uuidv4().substring(0, 8)}`,
      outbreakId: `OBK-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`,
      disease: resolvedDisease,
      diseaseCategory: resolvedDisease,
      severity: severity || 'High',
      riskCategory: severity || 'HIGH',
      clusterRadiusKm: Number(clusterRadiusKm) || 15,
      epicenter: epicenter || location || { lat: 18.5204, lng: 73.8567 },
      location: {
        type: 'Point',
        coordinates: [73.8567, 18.5204]
      },
      district: district || req.user.district || 'Pune',
      state: state || req.user.state || 'Maharashtra',
      caseCount: Number(casesCount) || 1,
      casesCount: Number(casesCount) || 1,
      status: 'Active Containment Zone',
      statusWording: 'Observed case cluster with elevated environmental risk factors',
      recommendation: 'Enhanced biosecurity, clinical screening, and vector control recommended.',
      description: description || 'Suspected outbreak cluster reported by field veterinary team.',
      createdAt: new Date().toISOString()
    };

    db.create('outbreaks', newOutbreak);

    // Push notification alert
    notificationService.notifyOutbreakAlert(newOutbreak.district, resolvedDisease, newOutbreak.severity);

    return res.status(201).json(newOutbreak);
  } catch (err) {
    console.error('Error reporting outbreak:', err);
    return res.status(500).json({ error: 'Failed to record outbreak.' });
  }
});

// POST /api/outbreaks/broadcast (Govt Admin broadcasts warning)
router.post('/broadcast', authenticate, requireRole('government_admin', 'ADMIN', 'admin'), (req, res) => {
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

    notificationService.sendNotification({
      segments: ['Subscribed Users'],
      title,
      message,
      data: { type: 'BROADCAST_ALERT', broadcast }
    });

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
