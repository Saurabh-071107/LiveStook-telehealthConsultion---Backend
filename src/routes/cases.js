const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const aiAnalyticsService = require('../services/aiAnalyticsService');
const { authenticate, requireRole } = require('../middleware/auth');

// GET /api/cases
router.get('/', authenticate, (req, res) => {
  try {
    const { status, suspectedOutbreak, district } = req.query;

    let cases = db.findAll('cases');

    if (req.user.role === 'farmer') {
      cases = cases.filter(c => c.farmerId === req.user.id);
    } else if (req.user.role === 'vet') {
      // Vets see their assigned cases or nearby open cases
      cases = cases.filter(c => !c.vetId || c.vetId === req.user.id);
    }

    if (status) cases = cases.filter(c => c.status === status);
    if (suspectedOutbreak !== undefined) {
      const isOutbreak = suspectedOutbreak === 'true';
      cases = cases.filter(c => c.suspectedOutbreak === isOutbreak);
    }
    if (district) cases = cases.filter(c => c.district.toLowerCase() === district.toLowerCase());

    // Sort by AI risk score descending (highest risk first)
    cases.sort((a, b) => (b.aiRiskScore || 0) - (a.aiRiskScore || 0));

    return res.json(cases);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve cases.' });
  }
});

// GET /api/cases/:id
router.get('/:id', authenticate, (req, res) => {
  try {
    const healthCase = db.findById('cases', req.params.id);
    if (!healthCase) return res.status(404).json({ error: 'Case not found.' });
    return res.json(healthCase);
  } catch (err) {
    return res.status(500).json({ error: 'Error fetching case.' });
  }
});

// POST /api/cases (Farmer files a new case / scan)
router.post('/', authenticate, requireRole('farmer', 'government_admin'), (req, res) => {
  try {
    const { animalId, symptoms = [], description = '', photoUrls = [], location } = req.body;

    if (!animalId || (!symptoms.length && !description)) {
      return res.status(400).json({ error: 'Animal ID and symptoms/description are required.' });
    }

    const animal = db.findById('animals', animalId);
    if (!animal) {
      return res.status(404).json({ error: 'Specified animal does not exist.' });
    }

    // Run AI / Analytics Engine
    const aiResult = aiAnalyticsService.analyzeSymptoms(symptoms, description);

    const newCase = {
      id: `case-${uuidv4().substring(0, 8)}`,
      animalId,
      farmerId: req.user.id,
      vetId: null,
      symptoms,
      description,
      photoUrls,
      aiRiskScore: aiResult.aiRiskScore,
      aiPredictedDisease: aiResult.aiPredictedDisease,
      aiConfidence: aiResult.aiConfidence,
      aiSeverity: aiResult.aiSeverity,
      suspectedOutbreak: aiResult.suspectedOutbreak,
      status: 'reported',
      vetNotes: '',
      recommendedTests: [],
      prescriptions: [],
      location: location || animal.location || req.user.location || { lat: 18.5204, lng: 73.8567 },
      district: req.user.district || 'Pune',
      state: req.user.state || 'Maharashtra',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    db.create('cases', newCase);

    // Update animal status to reflect sickness
    db.updateById('animals', animalId, {
      healthStatus: aiResult.aiRiskScore > 70 ? 'Critical' : 'Sick (Under Examination)'
    });

    return res.status(201).json(newCase);
  } catch (err) {
    console.error('Error reporting case:', err);
    return res.status(500).json({ error: 'Failed to record health case.' });
  }
});

// PATCH /api/cases/:id/vet-examination (Vet updates clinical exam, tests, prescriptions)
router.patch('/:id/vet-examination', authenticate, requireRole('vet', 'government_admin'), (req, res) => {
  try {
    const { vetNotes, recommendedTests, prescriptions, status, suspectedOutbreak } = req.body;
    const existingCase = db.findById('cases', req.params.id);
    if (!existingCase) {
      return res.status(404).json({ error: 'Case not found.' });
    }

    const updates = {
      vetId: req.user.id,
      status: status || 'under_examination'
    };

    if (vetNotes !== undefined) updates.vetNotes = vetNotes;
    if (recommendedTests !== undefined) updates.recommendedTests = recommendedTests;
    if (prescriptions !== undefined) updates.prescriptions = prescriptions;
    if (suspectedOutbreak !== undefined) updates.suspectedOutbreak = suspectedOutbreak;

    const updatedCase = db.updateById('cases', req.params.id, updates);

    // Requirement 8: Synchronize animal health status with doctor's clinical response
    if (existingCase.animalId) {
      const isResolved = updates.status === 'resolved';
      db.updateById('animals', existingCase.animalId, {
        healthStatus: isResolved ? 'Healthy' : 'Ongoing Treatment'
      });
    }

    return res.json(updatedCase);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update case examination.' });
  }
});

module.exports = router;
