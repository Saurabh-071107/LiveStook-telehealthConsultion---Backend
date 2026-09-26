const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

// GET /api/admin/stats (Aggregated overview KPIs for Government Dashboard)
router.get('/stats', authenticate, requireRole('government_admin'), (req, res) => {
  try {
    const vets = db.findAll('users', u => u.role === 'vet');
    const cases = db.findAll('cases');
    const outbreaks = db.findAll('outbreaks');
    const appointments = db.findAll('appointments');
    const schedules = db.findAll('vaccinationSchedules');
    const regulations = db.findAll('regulations');

    const totalDosesAllocated = schedules.reduce((s, item) => s + (item.totalDosesAllocated || 0), 0);
    const totalDosesAdministered = schedules.reduce((s, item) => s + (item.dosesAdministered || 0), 0);
    const coverageRate = totalDosesAllocated > 0 
      ? Math.round((totalDosesAdministered / totalDosesAllocated) * 100) 
      : 0;

    const stats = {
      totalVets: vets.length,
      pendingVetVerifications: vets.filter(v => v.verificationStatus === 'pending' || !v.isApproved).length,
      activeOutbreaks: outbreaks.filter(o => o.quarantineActive || o.status.includes('Active')).length,
      totalActiveCases: cases.filter(c => c.status !== 'treated' && c.status !== 'closed').length,
      highRiskCases: cases.filter(c => (c.aiRiskScore || 0) >= 70).length,
      vaccinationCoverageRate: coverageRate,
      totalVetCallsThisMonth: appointments.length,
      substandardDrugsFlagged: regulations.filter(r => r.status.includes('Seized') || r.status.includes('Banned')).length
    };

    return res.json(stats);
  } catch (err) {
    console.error('Stats error:', err);
    return res.status(500).json({ error: 'Failed to aggregate admin statistics.' });
  }
});

// GET /api/admin/vets (List all vets with verification credentials)
router.get('/vets', authenticate, requireRole('government_admin'), (req, res) => {
  try {
    const vets = db.findAll('users', u => u.role === 'vet');
    const safeVets = vets.map(({ password, ...safe }) => safe);
    return res.json(safeVets);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch veterinarians list.' });
  }
});

// PATCH /api/admin/vets/:id/verify (Verify or reject veterinarian)
router.patch('/vets/:id/verify', authenticate, requireRole('government_admin'), (req, res) => {
  try {
    const { status } = req.body; // 'verified', 'rejected', 'suspended'
    if (!status || !['verified', 'rejected', 'suspended'].includes(status)) {
      return res.status(400).json({ error: 'Valid status (verified, rejected, suspended) is required.' });
    }

    const vet = db.findById('users', req.params.id);
    if (!vet || vet.role !== 'vet') {
      return res.status(404).json({ error: 'Veterinarian not found.' });
    }

    const updated = db.updateById('users', req.params.id, {
      verificationStatus: status,
      isApproved: status === 'verified',
      availableForCalls: status === 'verified'
    });

    const { password, ...safe } = updated;
    return res.json(safe);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update vet verification status.' });
  }
});

module.exports = router;
