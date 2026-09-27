const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { Case, Animal, AIAnalysis, AuditLog } = require('../models');
const { isConnected } = require('../db/mongo');
const { authenticate, requireRole } = require('../middleware/auth');
const aiClientService = require('../services/ai-client.service');
const vetAssignmentService = require('../services/vet-assignment.service');
const notificationService = require('../services/notification.service');
const medicalReportService = require('../services/medical-report.service');

// Helper to generate human-readable Case ID: CASE-YYYY-NNNNNN
function generateCaseId() {
  const year = new Date().getFullYear();
  const seq = Math.floor(100000 + Math.random() * 900000);
  return `CASE-${year}-${seq}`;
}

// GET /api/cases (Filtered by role, status, district)
router.get('/', authenticate, async (req, res) => {
  try {
    const { status, district, animalId } = req.query;
    let cases = [];

    if (isConnected) {
      const query = {};
      const role = (req.user.role || '').toUpperCase();

      if (role === 'FARMER') {
        query.farmerId = req.user._id || req.user.id;
      } else if (role === 'VETERINARIAN') {
        query.$or = [
          { assignedVetId: req.user._id || req.user.id },
          { status: { $in: ['QUEUED', 'PENDING_ACCEPTANCE'] } }
        ];
      }

      if (status) query.status = status;
      if (district) query.district = district;
      if (animalId) query.animalId = animalId;

      cases = await Case.find(query).sort({ createdAt: -1 }).lean();
    } else {
      cases = db.findAll('cases');
      const role = (req.user.role || '').toLowerCase();

      if (role === 'farmer') {
        cases = cases.filter(c => c.farmerId === req.user.id);
      } else if (role === 'vet' || role === 'veterinarian') {
        cases = cases.filter(c => !c.vetId || c.vetId === req.user.id || c.status === 'QUEUED' || c.status === 'PENDING_ACCEPTANCE');
      }

      if (status) cases = cases.filter(c => c.status === status);
      if (district) cases = cases.filter(c => (c.district || '').toLowerCase() === district.toLowerCase());
      if (animalId) cases = cases.filter(c => c.animalId === animalId);
    }

    return res.json(cases);
  } catch (err) {
    console.error('Error fetching cases:', err);
    return res.status(500).json({ error: 'Failed to retrieve cases.' });
  }
});

// GET /api/cases/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    let healthCase;
    if (isConnected) {
      healthCase = await Case.findOne({
        $or: [{ caseId: req.params.id }, { _id: req.params.id.match(/^[0-9a-fA-F]{24}$/) ? req.params.id : null }]
      }).lean();
    } else {
      healthCase = db.findById('cases', req.params.id) ||
                   db.findAll('cases', c => c.caseId === req.params.id)[0];
    }

    if (!healthCase) return res.status(404).json({ error: 'Case not found.' });
    return res.json(healthCase);
  } catch (err) {
    return res.status(500).json({ error: 'Error fetching case.' });
  }
});

// GET /api/cases/:id/medical-history
router.get('/:id/medical-history', authenticate, async (req, res) => {
  try {
    let targetCase = db.findById('cases', req.params.id) || db.findAll('cases', c => c.caseId === req.params.id)[0];
    if (isConnected && !targetCase) {
      targetCase = await Case.findOne({ caseId: req.params.id }).lean();
    }
    if (!targetCase) return res.status(404).json({ error: 'Case not found.' });

    const history = await medicalReportService.getFullMedicalHistory(targetCase.animalId || targetCase.animalTag);
    return res.json(history);
  } catch (err) {
    return res.status(404).json({ error: err.message });
  }
});

// POST /api/cases (File a new health incident / scan)
router.post('/', authenticate, async (req, res) => {
  try {
    const {
      animalId,
      symptoms = [],
      majorSymptoms,
      description = '',
      additionalSymptoms,
      photoUrls = [],
      images = {},
      location
    } = req.body;

    const resolvedSymptoms = majorSymptoms || symptoms;
    const resolvedDescription = additionalSymptoms || description;

    if (!animalId || (!resolvedSymptoms.length && !resolvedDescription)) {
      return res.status(400).json({ error: 'Animal ID and symptoms/description are required.' });
    }

    // Lookup Animal
    let animal;
    if (isConnected) {
      animal = await Animal.findOne({
        $or: [{ animalId }, { earTagId: animalId }]
      }).lean();
    } else {
      animal = db.findById('animals', animalId) ||
               db.findAll('animals', a => a.tagNumber === animalId || a.earTagId === animalId)[0];
    }

    if (!animal) {
      return res.status(404).json({ error: `Animal '${animalId}' not found.` });
    }

    const caseId = generateCaseId();
    const animalTag = animal.earTagId || animal.tagNumber;
    const district = req.user.district || animal.district || 'Pune';
    const state = req.user.state || animal.state || 'Maharashtra';

    // 1. Call AI Analysis Microservice
    const aiInput = {
      animal_age: animal.ageYears || animal.age || 3,
      breed: animal.breed || 'Crossbred',
      type: animal.type || animal.species || 'Cow',
      gender: animal.gender || 'Female',
      major_symptoms: resolvedSymptoms,
      additional_symptoms: resolvedDescription,
      images: images || { front: photoUrls[0] || null }
    };

    const aiAssessment = await aiClientService.analyzeCase(aiInput);

    const initialStatus = aiAssessment.requires_veterinarian ? 'VET_REQUIRED' : 'LOW_RISK';

    const newCase = {
      id: caseId,
      caseId,
      animalId: animal.animalId || animal.id,
      animalTag,
      farmerId: req.user.id || req.user._id,
      assignedVetId: null,
      vetId: null,
      status: initialStatus,
      majorSymptoms: resolvedSymptoms,
      symptoms: resolvedSymptoms,
      additionalSymptoms: resolvedDescription,
      description: resolvedDescription,
      photoUrls,
      images,
      aiAnalysis: {
        riskLevel: aiAssessment.risk_level,
        possibleConditions: aiAssessment.possible_conditions,
        confidence: aiAssessment.confidence,
        recommendedTests: aiAssessment.recommended_tests,
        requiresVeterinarian: aiAssessment.requires_veterinarian,
        environmentalFactors: aiAssessment.environmental_factors,
        explanation: aiAssessment.explanation,
        modelVersion: aiAssessment.model_version || 'animal-health-v1'
      },
      preliminaryCondition: aiAssessment.possible_conditions[0] || 'General Bovine Health',
      severity: aiAssessment.risk_level === 'HIGH' ? 'HIGH' : (aiAssessment.risk_level === 'MEDIUM' ? 'MEDIUM' : 'LOW'),
      location: location || animal.location || { lat: 18.5204, lng: 73.8567 },
      district,
      state,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (isConnected) {
      const createdCase = await Case.create(newCase);
      await AIAnalysis.create({
        caseId: createdCase._id,
        modelVersion: aiAssessment.model_version || 'animal-health-v1',
        riskLevel: aiAssessment.risk_level,
        possibleConditions: aiAssessment.possible_conditions,
        confidence: aiAssessment.confidence,
        recommendedTests: aiAssessment.recommended_tests,
        requiresVeterinarian: aiAssessment.requires_veterinarian,
        environmentalFactors: aiAssessment.environmental_factors,
        explanation: aiAssessment.explanation
      });
    }

    db.create('cases', newCase);

    // Update Animal Health Status
    if (isConnected) {
      await Animal.findOneAndUpdate(
        { $or: [{ animalId: animal.animalId }, { earTagId: animalTag }] },
        { healthStatus: aiAssessment.risk_level === 'HIGH' ? 'Critical' : 'Ongoing Treatment' }
      );
    } else {
      db.updateById('animals', animal.id, {
        healthStatus: aiAssessment.risk_level === 'HIGH' ? 'Critical' : 'Ongoing Treatment'
      });
    }

    // 2. Automatic Vet Assignment if Clinical Attention Needed
    if (aiAssessment.requires_veterinarian) {
      vetAssignmentService.assignCase(caseId).then(assignmentResult => {
        if (assignmentResult.success && assignmentResult.assignedVetId) {
          notificationService.notifyCaseAssigned(
            assignmentResult.assignedVetId,
            caseId,
            animal.type || animal.species
          );
        }
      }).catch(err => {
        console.warn(`[Auto-Assignment] Notice for case ${caseId}: ${err.message}`);
      });
    }

    return res.status(201).json(newCase);
  } catch (err) {
    console.error('Error reporting case:', err);
    return res.status(500).json({ error: 'Failed to record health incident case.' });
  }
});

// POST /api/cases/:id/accept (Vet accepts case)
router.post('/:id/accept', authenticate, requireRole('vet', 'VETERINARIAN', 'government_admin', 'ADMIN'), async (req, res) => {
  try {
    const caseId = req.params.id;
    let targetCase = db.findById('cases', caseId) || db.findAll('cases', c => c.caseId === caseId)[0];

    if (isConnected) {
      const doc = await Case.findOne({ caseId }) || await Case.findById(caseId);
      if (doc) {
        doc.status = 'ACCEPTED';
        doc.assignedVetId = req.user._id || req.user.id;
        await doc.save();
        targetCase = doc.toObject();
      }
    }

    if (!targetCase) return res.status(404).json({ error: 'Case not found.' });

    db.updateById('cases', targetCase.id, {
      status: 'ACCEPTED',
      vetId: req.user.id,
      assignedVetId: req.user.id,
      acceptedAt: new Date().toISOString()
    });

    return res.json({
      success: true,
      caseId: targetCase.caseId,
      status: 'ACCEPTED',
      message: 'Case successfully accepted by attending veterinarian.'
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to accept case.' });
  }
});

// POST /api/cases/:id/reject (Vet rejects case -> returned to assignment pool)
router.post('/:id/reject', authenticate, requireRole('vet', 'VETERINARIAN', 'government_admin', 'ADMIN'), async (req, res) => {
  try {
    const caseId = req.params.id;
    const { reason } = req.body;
    const reassignResult = await vetAssignmentService.handleVetRejection(caseId, req.user.id || req.user._id, reason);
    return res.json({
      success: true,
      message: 'Case returned to assignment pool and routed to alternative veterinarian.',
      ...reassignResult
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to reject and reassign case.' });
  }
});

module.exports = router;
