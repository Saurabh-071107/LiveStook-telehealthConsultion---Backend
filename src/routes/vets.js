const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');

// GET /api/vets (Public or authenticated vet directory)
router.get('/', (req, res) => {
  try {
    const { district, verifiedOnly } = req.query;
    let vets = db.findAll('users', u => u.role === 'vet');

    if (verifiedOnly === 'true') {
      vets = vets.filter(v => v.verificationStatus === 'verified' && v.isApproved);
    }
    if (district) {
      vets = vets.filter(v => v.district?.toLowerCase() === district.toLowerCase());
    }

    // Strip passwords
    const safeVets = vets.map(({ password, ...safe }) => safe);
    return res.json(safeVets);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch veterinarians.' });
  }
});

module.exports = router;
