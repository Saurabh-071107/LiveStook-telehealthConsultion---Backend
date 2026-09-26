const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

// GET /api/regulations (Browse feed & medicine regulatory statuses)
router.get('/', authenticate, (req, res) => {
  try {
    const list = db.findAll('regulations');
    return res.json(list);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve regulations.' });
  }
});

// POST /api/regulations (Government Admin records seized/approved batches)
router.post('/', authenticate, requireRole('government_admin'), (req, res) => {
  try {
    const { productName, batchNumber, manufacturer, status, issueReported } = req.body;
    if (!productName || !batchNumber) {
      return res.status(400).json({ error: 'productName and batchNumber are required.' });
    }

    const newRegulation = {
      id: `reg-${uuidv4().substring(0, 8)}`,
      productName,
      batchNumber,
      manufacturer: manufacturer || 'Unknown Manufacturer',
      status: status || 'Under Inspection',
      issueReported: issueReported || '',
      reportedDate: new Date().toISOString().split('T')[0]
    };

    db.create('regulations', newRegulation);
    return res.status(201).json(newRegulation);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to add regulatory report.' });
  }
});

module.exports = router;
