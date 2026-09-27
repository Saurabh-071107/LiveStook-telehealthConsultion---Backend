const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { Consultation, Diagnosis, Treatment, Case, Animal, AuditLog } = require('../models');
const mongo = require('../db/mongo');
const { authenticate, requireRole } = require('../middleware/auth');
const agoraService = require('../services/agora.service');
const notificationService = require('../services/notification.service');
const aiClientService = require('../services/ai-client.service');

// POST /api/consultations/start (Only Vet can start consultation, 5-minute rule enforced)
router.post('/start', authenticate, requireRole('vet', 'VETERINARIAN', 'government_admin', 'ADMIN'), async (req, res) => {
  try {
    const { caseId, appointmentId, farmerId, animalId } = req.body;

    let appointment = null;
    if (appointmentId) {
      if (mongo.isConnected) {
        appointment = await Appointment.findById(appointmentId).lean();
      } else {
        appointment = db.findById('appointments', appointmentId);
      }
    }

    // Backend rule enforcement
    const check = agoraService.canStartCall(appointment, req.user);
    if (!check.allowed) {
      return res.status(403).json({ error: check.reason, earliestAllowedStart: check.earliestAllowedStart });
    }

    const resolvedCaseId = caseId || (appointment ? appointment.caseId : `CASE-${new Date().getFullYear()}-001`);
    const channelName = agoraService.getChannelName(resolvedCaseId);
    const callId = agoraService.generateCallId();
    const tokenInfo = agoraService.generateRtcToken(channelName, req.user.id || 1, 'PUBLISHER', 7200);

    const consultationDoc = {
      id: `cons-${uuidv4().substring(0, 8)}`,
      consultationId: `CNS-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`,
      caseId: resolvedCaseId,
      callId,
      farmerId: farmerId || (appointment ? appointment.farmerId : null),
      vetId: req.user.id || req.user._id,
      vetName: req.user.name,
      animalId,
      agoraChannel: channelName,
      status: 'CONSULTATION_ACTIVE',
      startedAt: new Date().toISOString()
    };

    if (mongo.isConnected) {
      await Consultation.create(consultationDoc);
      await Case.findOneAndUpdate({ caseId: resolvedCaseId }, { status: 'CONSULTATION_ACTIVE' });
    }

    db.create('consultations', consultationDoc);
    if (consultationDoc.farmerId) {
      notificationService.notifyConsultationReady(consultationDoc.farmerId, resolvedCaseId);
    }

    return res.status(201).json({
      success: true,
      message: 'Consultation call successfully initialized.',
      callId,
      consultationId: consultationDoc.consultationId,
      channelName,
      agoraAppId: tokenInfo.appId,
      token: tokenInfo.token,
      uid: tokenInfo.uid
    });
  } catch (err) {
    console.error('Consultation start error:', err);
    return res.status(500).json({ error: 'Failed to start consultation.' });
  }
});

// POST /api/consultations/:id/diagnosis (Vet records final diagnosis)
router.post('/:id/diagnosis', authenticate, requireRole('vet', 'VETERINARIAN', 'government_admin', 'ADMIN'), async (req, res) => {
  try {
    const { caseId, animalId, finalDiagnosis, differentialDiagnosis = [], clinicalFindings = '', severity = 'MODERATE' } = req.body;

    if (!finalDiagnosis) {
      return res.status(400).json({ error: 'Final diagnosis is required.' });
    }

    const diagnosisId = `DX-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;

    const diagnosisDoc = {
      id: diagnosisId,
      diagnosisId,
      consultationId: req.params.id,
      caseId,
      animalId,
      vetId: req.user.id || req.user._id,
      vetName: req.user.name,
      finalDiagnosis,
      differentialDiagnosis,
      clinicalFindings,
      severity,
      createdAt: new Date().toISOString()
    };

    if (mongo.isConnected) {
      await Diagnosis.create(diagnosisDoc);
      if (caseId) {
        await Case.findOneAndUpdate({ caseId }, { status: 'DIAGNOSIS_COMPLETED' });
      }
    }

    db.create('diagnoses', diagnosisDoc);

    return res.status(201).json({
      success: true,
      message: 'Final veterinary diagnosis officially recorded.',
      diagnosis: diagnosisDoc
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to save diagnosis.' });
  }
});

// POST /api/consultations/:id/treatment (Vet prescribes medicines and treatment regimen)
router.post('/:id/treatment', authenticate, requireRole('vet', 'VETERINARIAN', 'government_admin', 'ADMIN'), async (req, res) => {
  try {
    const { caseId, animalId, diagnosisSummary, medicines = [], durationDays = 5, followUpDate, specialInstructions = '' } = req.body;

    if (!medicines || medicines.length === 0) {
      return res.status(400).json({ error: 'At least one medicine prescription is required.' });
    }

    const treatmentId = `TRT-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;

    const treatmentDoc = {
      id: treatmentId,
      treatmentId,
      consultationId: req.params.id,
      caseId,
      animalId,
      vetId: req.user.id || req.user._id,
      vetName: req.user.name,
      diagnosisSummary,
      medicines,
      durationDays: Number(durationDays),
      followUpDate,
      specialInstructions,
      createdAt: new Date().toISOString()
    };

    if (mongo.isConnected) {
      await Treatment.create(treatmentDoc);
      if (caseId) {
        await Case.findOneAndUpdate({ caseId }, { status: 'TREATMENT_CREATED' });
      }
    }

    db.create('treatments', treatmentDoc);

    return res.status(201).json({
      success: true,
      message: 'Treatment regimen & prescription successfully finalized.',
      treatment: treatmentDoc
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to save treatment.' });
  }
});

// POST /api/consultations/:id/recommend-test (Vet recommends diagnostic test)
router.post('/:id/recommend-test', authenticate, requireRole('vet', 'VETERINARIAN', 'government_admin', 'ADMIN'), async (req, res) => {
  try {
    const { caseId, animalId, farmerId, testType, priority = 'NORMAL', notes = '' } = req.body;

    if (!testType) {
      return res.status(400).json({ error: 'Test type is required.' });
    }

    const recommendation = {
      id: `rec-${uuidv4().substring(0, 8)}`,
      consultationId: req.params.id,
      caseId,
      animalId,
      farmerId,
      vetId: req.user.id,
      vetName: req.user.name,
      testType,
      priority,
      notes,
      status: 'RECOMMENDED',
      createdAt: new Date().toISOString()
    };

    if (mongo.isConnected && caseId) {
      await Case.findOneAndUpdate({ caseId }, { status: 'TEST_RECOMMENDED' });
    }

    db.create('testRecommendations', recommendation);

    if (farmerId) {
      notificationService.sendNotification({
        userIds: [farmerId.toString()],
        title: 'Diagnostic Test Recommended',
        message: `Dr. ${req.user.name} recommended a ${testType} test. Tap to book a lab slot.`,
        data: { type: 'TEST_RECOMMENDED', testType, caseId }
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Test recommendation issued to farmer.',
      recommendation
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to recommend test.' });
  }
});

// POST /api/consultations/:id/end (Conclude consultation)
router.post('/:id/end', authenticate, async (req, res) => {
  try {
    const { callNotes = '', durationMinutes = 0 } = req.body;

    const existing = db.findById('consultations', req.params.id) ||
                     db.findAll('consultations', c => c.consultationId === req.params.id)[0];

    const updates = {
      status: 'CONSULTATION_COMPLETED',
      endedAt: new Date().toISOString(),
      callNotes,
      durationMinutes
    };

    if (existing) {
      db.updateById('consultations', existing.id, updates);
      if (existing.caseId) {
        db.updateById('cases', existing.caseId, { status: 'CONSULTATION_COMPLETED' });
      }
    }

    return res.json({
      success: true,
      message: 'Consultation concluded successfully.'
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to end consultation.' });
  }
});

// POST /api/consultations/vet-ai-assist (Strictly confidential Doctor-Only Clinical Decision Support)
router.post('/vet-ai-assist', authenticate, requireRole('vet', 'VETERINARIAN', 'government_admin', 'ADMIN'), async (req, res) => {
  try {
    const {
      caseId,
      appointmentId,
      symptoms = [],
      additionalInfo = '',
      type,
      species = 'Cow',
      animalType = 'Cattle'
    } = req.body;

    let payloadSymptoms = Array.isArray(symptoms) ? symptoms : [symptoms];
    let payloadSpecies = species || animalType || 'Cow';
    let payloadAdditional = additionalInfo;

    // If appointmentId or caseId provided, supplement with intake data
    if (appointmentId) {
      const apt = db.findById('appointments', appointmentId);
      if (apt) {
        if (apt.symptoms && Array.isArray(apt.symptoms) && apt.symptoms.length > 0) {
          payloadSymptoms = [...new Set([...payloadSymptoms, ...apt.symptoms])];
        }
        if (apt.species) payloadSpecies = apt.species;
        if (apt.description) payloadAdditional = `${payloadAdditional} ${apt.description}`.trim();
      }
    }

    if (caseId) {
      const c = db.findById('cases', caseId) || db.findAll('cases', item => item.caseId === caseId)[0];
      if (c) {
        if (c.symptoms && Array.isArray(c.symptoms)) {
          payloadSymptoms = [...new Set([...payloadSymptoms, ...c.symptoms])];
        }
        if (c.species) payloadSpecies = c.species;
        if (c.description) payloadAdditional = `${payloadAdditional} ${c.description}`.trim();
      }
    }

    const aiPayload = {
      major_symptoms: payloadSymptoms,
      additional_symptoms: payloadAdditional,
      type: payloadSpecies,
      species: payloadSpecies
    };

    const clinicalAssist = aiClientService.getDoctorClinicalAssist(aiPayload);
    return res.json({
      success: true,
      ...clinicalAssist
    });
  } catch (err) {
    console.error('Vet AI Assist error:', err);
    return res.status(500).json({ error: 'Failed to generate clinical decision support.' });
  }
});

// GET /api/consultations/:id/vet-ai-assist (Fetch clinical assist for a consultation/case)
router.get('/:id/vet-ai-assist', authenticate, requireRole('vet', 'VETERINARIAN', 'government_admin', 'ADMIN'), async (req, res) => {
  try {
    const id = req.params.id;
    let apt = db.findById('appointments', id) || db.findAll('appointments', a => a.id === id || a.callRoomId === id)[0];
    let targetCase = db.findById('cases', id) || db.findAll('cases', c => c.caseId === id || c.id === id)[0];

    const symptoms = [];
    let species = 'Cow';
    let additional = '';

    if (apt) {
      if (apt.symptoms) symptoms.push(...(Array.isArray(apt.symptoms) ? apt.symptoms : [apt.symptoms]));
      if (apt.species) species = apt.species;
      if (apt.description) additional += ' ' + apt.description;
    }
    if (targetCase) {
      if (targetCase.symptoms) symptoms.push(...(Array.isArray(targetCase.symptoms) ? targetCase.symptoms : [targetCase.symptoms]));
      if (targetCase.species) species = targetCase.species;
      if (targetCase.description) additional += ' ' + targetCase.description;
    }

    const clinicalAssist = aiClientService.getDoctorClinicalAssist({
      major_symptoms: symptoms,
      additional_symptoms: additional.trim(),
      type: species,
      species
    });

    return res.json({
      success: true,
      ...clinicalAssist
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve clinical decision support.' });
  }
});

module.exports = router;
