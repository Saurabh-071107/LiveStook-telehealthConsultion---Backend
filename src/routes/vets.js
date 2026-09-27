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

// GET /api/vets/emergency-duty  (Gov dashboard: see all vets currently on emergency duty)
router.get('/emergency-duty', (req, res) => {
  try {
    const dutyVets = db.findAll('users', u => u.role === 'vet' && u.emergencyDuty === true);
    const safe = dutyVets.map(({ password, ...v }) => ({
      id: v.id,
      name: v.name,
      phone: v.phone,
      district: v.district,
      specialization: v.specialization,
      licenseNumber: v.licenseNumber,
      emergencyDutySince: v.emergencyDutySince || null,
    }));
    return res.json({ onDuty: safe, count: safe.length });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch emergency duty vets.' });
  }
});

// PATCH /api/vets/emergency-duty  (Vet toggles their own emergency duty status)
router.patch('/emergency-duty', authenticate, (req, res) => {
  try {
    const { enabled } = req.body;
    const vetId = req.user?.id;
    if (!vetId) return res.status(401).json({ error: 'Unauthorized' });

    const vet = db.findOne('users', u => u.id === vetId);
    if (!vet) return res.status(404).json({ error: 'Vet not found.' });

    vet.emergencyDuty = !!enabled;
    vet.emergencyDutySince = enabled ? new Date().toISOString() : null;
    db.update('users', vet);

    return res.json({
      success: true,
      emergencyDuty: vet.emergencyDuty,
      message: enabled
        ? 'You are now marked as ON Emergency Duty. Government dashboard can see you.'
        : 'Emergency Duty deactivated.',
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update emergency duty status.' });
  }
});

module.exports = router;

