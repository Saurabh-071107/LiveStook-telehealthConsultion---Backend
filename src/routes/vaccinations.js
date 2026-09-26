const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

// GET /api/vaccinations/schedules
router.get('/schedules', authenticate, (req, res) => {
  try {
    const { district, status } = req.query;
    let list = db.findAll('vaccinationSchedules');
    if (district) list = list.filter(v => v.district.toLowerCase() === district.toLowerCase());
    if (status) list = list.filter(v => v.status === status);
    return res.json(list);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch vaccination schedules.' });
  }
});

// POST /api/vaccinations/schedules (Govt Admin only)
router.post('/schedules', authenticate, requireRole('government_admin'), (req, res) => {
  try {
    const { title, diseaseTarget, targetSpecies, district, state, centerName, startDate, endDate, totalDosesAllocated, batchNumber } = req.body;
    const newSchedule = {
      id: `vac-${uuidv4().substring(0, 8)}`,
      title,
      diseaseTarget,
      targetSpecies: targetSpecies || ['Cattle', 'Buffalo'],
      district: district || 'Pune',
      state: state || 'Maharashtra',
      centerName: centerName || 'District Veterinary Centre',
      startDate,
      endDate,
      totalDosesAllocated: Number(totalDosesAllocated) || 10000,
      dosesAdministered: 0,
      isFreeGovernmentDrive: true,
      batchNumber: batchNumber || `VAC-${Date.now()}`,
      status: 'active'
    };
    db.create('vaccinationSchedules', newSchedule);
    return res.status(201).json(newSchedule);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to create vaccination schedule.' });
  }
});

// GET /api/vaccinations/bookings
router.get('/bookings', authenticate, (req, res) => {
  try {
    let list = db.findAll('vaccinationBookings');
    if (req.user.role === 'farmer') {
      list = list.filter(b => b.farmerId === req.user.id);
    }

    // Enrich with animal, schedule, and farmer info for vet and farmer dashboards
    const enriched = list.map(b => {
      const animal = db.findById('animals', b.animalId) || {};
      const schedule = db.findById('vaccinationSchedules', b.scheduleId) || {};
      const farmer = db.findById('users', b.farmerId) || {};
      return {
        ...b,
        animalName: b.animalName || animal.name || 'Livestock',
        animalTag: b.animalTag || animal.tagNumber || b.animalId,
        species: b.species || (animal.species ? `${animal.species} (${animal.breed || ''})` : 'Livestock'),
        farmerName: b.farmerName || farmer.name || 'Farmer',
        farmerPhone: b.farmerPhone || farmer.phone || '+91 98765 43210',
        village: b.village || farmer.village || 'Pune',
        vaccineName: b.vaccineName || schedule.title || 'Government Scheduled Vaccine',
        centerName: b.centerName || schedule.centerName || 'Veterinary Dispensary',
        batchNumber: b.batchNumber || schedule.batchNumber || 'VAC-2026',
        timeSlot: b.slot || b.timeSlot || '09:30 AM - 11:30 AM'
      };
    });

    return res.json(enriched);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch bookings.' });
  }
});

// POST /api/vaccinations/bookings (Farmer books slot)
router.post('/bookings', authenticate, requireRole('farmer', 'government_admin'), (req, res) => {
  try {
    const { scheduleId, animalId, bookedDate, slot } = req.body;
    if (!scheduleId || !animalId) {
      return res.status(400).json({ error: 'scheduleId and animalId are required.' });
    }

    const animal = db.findById('animals', animalId) || {};
    const schedule = db.findById('vaccinationSchedules', scheduleId) || {};

    const booking = {
      id: `vb-${uuidv4().substring(0, 8)}`,
      scheduleId,
      farmerId: req.user.id,
      farmerName: req.user.name || 'Farmer',
      farmerPhone: req.user.phone || '+91 98765 43210',
      village: req.user.village || 'Pune',
      animalId,
      animalName: animal.name || 'Livestock',
      animalTag: animal.tagNumber || animalId,
      species: animal.species ? `${animal.species} (${animal.breed || ''})` : 'Livestock',
      vaccineName: schedule.title || schedule.diseaseTarget || 'Government Vaccine',
      centerName: schedule.centerName || 'Veterinary Centre',
      batchNumber: schedule.batchNumber || 'VAC-2026',
      bookedDate: bookedDate || new Date().toISOString().split('T')[0],
      slot: slot || 'Morning (09:00 AM - 12:00 PM)',
      status: 'Confirmed',
      certificateIssued: false,
      createdAt: new Date().toISOString()
    };

    db.create('vaccinationBookings', booking);
    return res.status(201).json(booking);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to book vaccination.' });
  }
});

// PATCH /api/vaccinations/bookings/:id/status (Vet or Admin updates status)
router.patch('/bookings/:id/status', authenticate, (req, res) => {
  try {
    const { status } = req.body;
    const existing = db.findById('vaccinationBookings', req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Vaccination booking not found.' });
    }

    const updated = db.updateById('vaccinationBookings', req.params.id, {
      status: status || existing.status,
      updatedAt: new Date().toISOString()
    });

    return res.json(updated);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update vaccination booking status.' });
  }
});

module.exports = router;
