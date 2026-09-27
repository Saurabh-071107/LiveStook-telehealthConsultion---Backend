const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { Case, Animal, AIAnalysis, AuditLog, Farmer } = require('../models');
const mongo = require('../db/mongo');
const mongoose = require('mongoose');
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

    if (mongo.isConnected) {
      const query = {};
      const role = (req.user.role || '').toLowerCase();

      if (role === 'farmer') {
        // Match by farmerId string (JSON-backed users use string IDs like 'usr-farmer-1')
        query.$or = [
          { farmerId: req.user._id ? req.user._id.toString() : null },
          { farmerId: req.user.id }
        ].filter(o => Object.values(o)[0] != null);
        if (query.$or.length === 1) { query.farmerId = query.$or[0].farmerId; delete query.$or; }
      } else if (role === 'vet' || role === 'veterinarian') {
        query.$or = [
          { assignedVetId: req.user._id ? req.user._id.toString() : null },
          { assignedVetId: req.user.id },
          { status: { $in: ['QUEUED', 'PENDING_ACCEPTANCE', 'VET_REQUIRED'] } }
        ].filter(o => !o.assignedVetId || o.assignedVetId != null);
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
    if (mongo.isConnected) {
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
    if (mongo.isConnected && !targetCase) {
      targetCase = await Case.findOne({ caseId: req.params.id }).lean();
    }
    if (!targetCase) return res.status(404).json({ error: 'Case not found.' });

    const history = await medicalReportService.getFullMedicalHistory(targetCase.animalId || targetCase.animalTag);
    return res.json(history);
  } catch (err) {
    return res.status(404).json({ error: err.message });
  }
});

// POST /api/cases/verify-animal-photo (Mandatory real-time verification that uploaded photo depicts an animal)
router.post('/verify-animal-photo', authenticate, async (req, res) => {
  try {
    const { imageBase64, imageUrl, fileName } = req.body;
    const result = await aiClientService.verifyAnimalPhoto({ imageBase64, imageUrl, fileName });
    if (!result.isAnimal) {
      return res.status(400).json(result);
    }
    return res.json(result);
  } catch (err) {
    console.error('Error verifying animal photo:', err);
    return res.status(500).json({ isAnimal: false, error: 'Failed to verify animal photo.' });
  }
});

// POST /api/cases (Farmer submits new case with MANDATORY animal photo & AI analysis)
router.post('/', authenticate, requireRole('farmer', 'FARMER', 'vet', 'VETERINARIAN', 'government_admin', 'ADMIN'), async (req, res) => {
  try {
    const {
      animalId,
      symptoms = [],
      majorSymptoms = [],
      description = '',
      additionalSymptoms,
      photoUrls = [],
      images = {},
      location
    } = req.body;

    const resolvedSymptoms = majorSymptoms.length ? majorSymptoms : symptoms;
    const resolvedDescription = additionalSymptoms || description;

    if (!animalId || (!resolvedSymptoms.length && !resolvedDescription)) {
      return res.status(400).json({ error: 'Animal ID and symptoms/description are required.' });
    }

    // MANDATORY PHOTO VERIFICATION: At least one clear photo of animal or clinical area is strictly required
    const primaryPhoto = (photoUrls && photoUrls.length > 0) ? photoUrls[0] : (images?.front || null);
    if (!primaryPhoto) {
      return res.status(400).json({
        error: 'Upload of at least one photo of the animal or affected clinical area is strictly mandatory.'
      });
    }

    // Verify that the photo is an animal
    const photoVerification = await aiClientService.verifyAnimalPhoto({
      imageUrl: primaryPhoto,
      imageBase64: primaryPhoto.startsWith('data:') ? primaryPhoto : null
    });

    if (!photoVerification.isAnimal) {
      return res.status(400).json({
        error: photoVerification.error || 'The uploaded photo does not appear to be an animal. Please upload a clear photo of your livestock or the visible clinical sign.'
      });
    }

    // Lookup Animal
    let animal;
    if (mongo.isConnected) {
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

    // Resolve Farmer profile ObjectId
    const userId = req.user._id || req.user.id;
    let farmerDoc = null;
    if (mongo.isConnected) {
      if (mongoose.isValidObjectId(userId)) {
        farmerDoc = await Farmer.findOne({ userId });
      }
      if (!farmerDoc && req.user.phone) {
        farmerDoc = await Farmer.findOne({ phone: req.user.phone });
      }
    }
    const farmerProfileId = farmerDoc?._id || (mongoose.isValidObjectId(userId) ? userId : new mongoose.Types.ObjectId());
    const imageList = (photoUrls && photoUrls.length) ? photoUrls : [primaryPhoto];

    // 1. Call AI Analysis Microservice / Clinical Dataset Engine
    const aiInput = {
      animal_age: animal.ageYears || animal.age || 3,
      breed: animal.breed || 'Crossbred',
      type: animal.type || animal.species || 'Cow',
      gender: animal.gender || 'Female',
      major_symptoms: resolvedSymptoms,
      additional_symptoms: resolvedDescription,
      images: { front: primaryPhoto },
      photoUrls: imageList
    };

    const aiAssessment = await aiClientService.analyzeCase(aiInput);

    const initialStatus = aiAssessment.requires_veterinarian ? 'VET_REQUIRED' : 'LOW_RISK';

    const newCase = {
      id: caseId,
      caseId,
      animalId: animal.animalId || animal.id,
      animalTag,
      farmerId: farmerProfileId,
      farmerUserId: userId,
      farmerPhone: req.user.phone || '',
      assignedVetId: null,
      vetId: null,
      status: initialStatus,
      majorSymptoms: resolvedSymptoms,
      symptoms: resolvedSymptoms,
      additionalSymptoms: resolvedDescription,
      description: resolvedDescription,
      photoUrls: imageList,
      images: imageList,
      aiAnalysis: {
        riskLevel: aiAssessment.risk_level,
        severity: aiAssessment.severity || aiAssessment.risk_level,
        primaryCondition: aiAssessment.primary_condition || (aiAssessment.possible_conditions && aiAssessment.possible_conditions[0]),
        possibleConditions: aiAssessment.possible_conditions || [],
        confidence: aiAssessment.confidence,
        recommendedTests: aiAssessment.recommended_tests || [],
        firstAid: aiAssessment.first_aid || [],
        urgencyLabel: aiAssessment.urgency_label || 'Seek Vet Care',
        requiresVeterinarian: aiAssessment.requires_veterinarian,
        environmentalFactors: aiAssessment.environmental_factors || [],
        explanation: aiAssessment.explanation,
        modelVersion: aiAssessment.model_version || 'animal-health-v2-prod'
      },
      preliminaryCondition: aiAssessment.primary_condition || (aiAssessment.possible_conditions && aiAssessment.possible_conditions[0]) || 'General Bovine Health',
      severity: aiAssessment.severity || (aiAssessment.risk_level === 'HIGH' ? 'HIGH' : (aiAssessment.risk_level === 'MEDIUM' ? 'MEDIUM' : 'LOW')),
      location: location || animal.location || { lat: 18.5204, lng: 73.8567 },
      district,
      state,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (mongo.isConnected) {
      const createdCase = await Case.create(newCase);
      const conditionsFormatted = (aiAssessment.possible_conditions || []).map((cond, idx) => {
        if (typeof cond === 'string') {
          return {
            name: cond,
            probability: idx === 0 ? aiAssessment.confidence : Math.max(0.3, +(aiAssessment.confidence - idx * 0.15).toFixed(2)),
            severity: aiAssessment.severity || 'Moderate'
          };
        }
        return cond;
      });

      try {
        await AIAnalysis.create({
          caseId: createdCase.caseId || createdCase._id.toString(),
          animalId: animal.animalId || animal.id || animalTag,
          modelVersion: aiAssessment.model_version || 'animal-health-v2-prod',
          riskLevel: aiAssessment.risk_level,
          possibleConditions: conditionsFormatted,
          confidence: aiAssessment.confidence,
          recommendedTests: aiAssessment.recommended_tests || [],
          requiresVeterinarian: aiAssessment.requires_veterinarian,
          environmentalFactors: aiAssessment.environmental_factors || [],
          explanation: aiAssessment.explanation || ''
        });
      } catch (aiErr) {
        console.warn('AIAnalysis log warning:', aiErr.message);
      }
    }

    db.create('cases', newCase);

    // Update Animal Health Status
    if (mongo.isConnected) {
      await Animal.findOneAndUpdate(
        { $or: [{ animalId: animal.animalId }, { earTagId: animalTag }] },
        { healthStatus: (aiAssessment.severity === 'CRITICAL' || aiAssessment.severity === 'HIGH') ? 'Critical' : 'Ongoing Treatment' }
      );
    }
 else {
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

    if (mongo.isConnected) {
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
