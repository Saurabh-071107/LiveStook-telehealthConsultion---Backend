const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authenticate } = require('../middleware/auth');

// GET /api/appointments
router.get('/', authenticate, (req, res) => {
  try {
    let list = db.findAll('appointments');
    if (req.user.role === 'farmer') {
      list = list.filter(a => a.farmerId === req.user.id);
    } else if (req.user.role === 'vet') {
      list = list.filter(a => 
        a.vetId === req.user.id || 
        a.status === 'in_queue' || 
        a.callStatus === 'waiting' || 
        a.callStatus === 'ringing' ||
        !a.vetId
      );
    }
    // Sort in-queue / waiting triage tickets to the top
    list.sort((a, b) => {
      const aPriority = (a.status === 'in_queue' || a.callStatus === 'waiting' || a.callStatus === 'ringing') ? 1 : 0;
      const bPriority = (b.status === 'in_queue' || b.callStatus === 'waiting' || b.callStatus === 'ringing') ? 1 : 0;
      if (aPriority !== bPriority) return bPriority - aPriority;
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });
    return res.json(list);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve appointments.' });
  }
});

// POST /api/appointments (Book a Vet Call or Visit)
router.post('/', authenticate, (req, res) => {
  try {
    const { vetId, animalId, caseId, scheduledAt, type, notes } = req.body;
    
    // Find or auto-assign active veterinarian
    let vet = null;
    if (vetId) {
      vet = db.findById('users', vetId);
    }
    if (!vet) {
      // Pick available vet from system
      vet = db.findAll('users', u => u.role === 'vet' && u.availableForCalls)[0] ||
            db.findAll('users', u => u.role === 'vet')[0];
    }

    // Find animal details if provided
    let animal = null;
    if (animalId) {
      animal = db.findById('animals', animalId) || 
               db.findAll('animals', a => a.tagNumber === animalId || a.name === animalId)[0];
    }

    // Determine scheduled appointment time (default to 20 minutes from now for immediate virtual triage)
    const slotTime = scheduledAt ? new Date(scheduledAt) : new Date(Date.now() + 20 * 60 * 1000);
    const timeFormatted = slotTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    const dateFormatted = slotTime.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

    const newAppointment = {
      id: `apt-${uuidv4().substring(0, 8)}`,
      farmerId: req.user.id,
      farmerName: req.user.name || 'Farmer',
      farmerPhone: req.user.phone || '+91 98765 43210',
      village: req.user.village || 'Khed, Pune',
      vetId: vet ? vet.id : 'usr-vet-1',
      vetName: vet ? vet.name : 'Dr. Anand Sharma',
      vetSpecialization: vet ? vet.specialization : 'Bovine Medicine & Surgery',
      vetPhone: vet ? vet.phone : '+91 98220 11223',
      hospitalClinic: vet ? vet.hospitalClinic : 'Rural Veterinary Dispensary, Pune Division',
      animalId: animal ? animal.id : (animalId || 'SYS-ANML-001234'),
      animalName: animal ? animal.name : 'Livestock',
      animalTag: animal ? animal.tagNumber : (animalId || 'MH001234'),
      caseId: caseId || null,
      scheduledAt: slotTime.toISOString(),
      scheduledTime: `${dateFormatted}, ${timeFormatted}`,
      appointmentTimeFormatted: `${dateFormatted}, ${timeFormatted}`,
      type: type || 'video_call', // 'video_call', 'voice_call', 'physical_visit'
      status: 'scheduled',
      callRoomId: `room-${uuidv4().substring(0, 10)}`,
      notes: notes || 'Consultation request from farmer mobile app',
      callNotes: '',
      callDurationMinutes: 0,
      createdAt: new Date().toISOString()
    };

    db.create('appointments', newAppointment);

    return res.status(201).json({
      success: true,
      message: `Appointment successfully scheduled with ${newAppointment.vetName}.`,
      appointment: newAppointment
    });
  } catch (err) {
    console.error('Book appointment error:', err);
    return res.status(500).json({ error: 'Failed to book appointment.' });
  }
});

// POST /api/appointments/queue-call (Instant Queue Triage Registration)
router.post('/queue-call', authenticate, (req, res) => {
  try {
    const {
      doctorName,
      doctorImage,
      animalName,
      animalTag,
      expectedTime,
      vetId,
      doctorId,
      symptoms,
      description,
      photoUrls,
      photos,
      animalId,
      species,
    } = req.body;
    const targetVetId = vetId || doctorId || 'usr-vet-1';
    const vet = db.findById('users', targetVetId) || db.findAll('users', u => u.role === 'vet')[0];
    const callRoomId = `agora-${uuidv4().substring(0, 10)}`;
    const parsedSymptoms = Array.isArray(symptoms) ? symptoms : (symptoms ? [symptoms] : []);
    const parsedPhotos = Array.isArray(photoUrls) ? photoUrls : (Array.isArray(photos) ? photos : []);

    const newQueueApt = {
      id: `queue-${uuidv4().substring(0, 8)}`,
      farmerId: req.user.id,
      farmerName: req.user.name || 'Farmer',
      farmerPhone: req.user.phone || '+91 98765 43210',
      village: req.user.village || 'Pune',
      vetId: vet ? vet.id : targetVetId,
      vetName: vet ? vet.name : (doctorName || 'Dr. Anand Sharma'),
      vetSpecialization: vet ? vet.specialization : 'Bovine Medicine & Surgery',
      vetPhone: vet ? vet.phone : '+91 98220 11223',
      hospitalClinic: vet ? vet.hospitalClinic : 'Rural Veterinary Dispensary, Pune Division',
      vetImage: doctorImage || 'assets/images/doctor_1.png',
      animalId: animalId || null,
      animalName: animalName || 'Livestock',
      animalTag: animalTag || 'MH-LIVE-01',
      species: species || 'Cattle',
      symptoms: parsedSymptoms,
      description: description || '',
      photoUrls: parsedPhotos,
      type: 'video_call',
      status: 'in_queue',
      callStatus: 'waiting', // waiting | ringing | active | completed | declined
      callRoomId,
      agoraChannel: callRoomId,
      scheduledAt: new Date().toISOString(),
      scheduledTime: 'Instant Triage Queue',
      notes: description
        ? `${description} (Symptoms: ${parsedSymptoms.join(', ')})`
        : `Virtual triage queue wait (~${expectedTime || '2-4 mins'}) - Symptoms: ${parsedSymptoms.join(', ')}`,
      createdAt: new Date().toISOString()
    };

    db.create('appointments', newQueueApt);
    return res.status(201).json(newQueueApt);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to create queue appointment.' });
  }
});

// GET /api/appointments/incoming-call (Poll / fetch ringing call for farmer)
router.get('/incoming-call', authenticate, (req, res) => {
  try {
    const list = db.findAll('appointments');
    // Find appointment where farmerId matches, and callStatus is 'ringing' or 'active' within last 5 minutes
    const activeRinging = list.find(a => 
      a.farmerId === req.user.id &&
      (a.callStatus === 'ringing' || a.callStatus === 'active') &&
      a.callStartedAt && (Date.now() - new Date(a.callStartedAt).getTime() < 5 * 60 * 1000)
    );

    if (activeRinging) {
      return res.json({
        hasIncomingCall: true,
        appointment: activeRinging,
        agoraChannel: activeRinging.agoraChannel || activeRinging.callRoomId,
        agoraAppId: process.env.AGORA_APP_ID || 'demo_agora_pashu_app_id'
      });
    }

    return res.json({ hasIncomingCall: false });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to check incoming calls.' });
  }
});

// POST /api/appointments/:id/start-call (Doctor initiates Agora call - 5 min check enforced)
router.post('/:id/start-call', authenticate, (req, res) => {
  try {
    const existing = db.findById('appointments', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Appointment not found.' });

    // Enforce 5-minute pre-call rule for scheduled appointments
    if (existing.scheduledAt && existing.status !== 'in_queue' && !existing.scheduledTime?.toLowerCase().includes('queue')) {
      const scheduledTime = new Date(existing.scheduledAt).getTime();
      const now = Date.now();
      const earliestAllowed = scheduledTime - 5 * 60 * 1000; // 5 mins before
      const latestAllowed = scheduledTime + 3 * 60 * 60 * 1000; // 3 hours window

      if (now < earliestAllowed) {
        const minsRemaining = Math.ceil((earliestAllowed - now) / 60000);
        return res.status(403).json({
          error: `Appointment room unlocks 5 minutes before scheduled time. Please wait ${minsRemaining} minute(s).`,
          unlocksInMinutes: minsRemaining
        });
      }
    }

    const agoraChannel = existing.callRoomId || `agora-${req.params.id}`;
    const updated = db.updateById('appointments', req.params.id, {
      callStatus: 'ringing',
      callStartedAt: new Date().toISOString(),
      agoraChannel,
      updatedAt: new Date().toISOString()
    });

    return res.json({
      success: true,
      message: 'Call initiated. Ringing patient...',
      agoraChannel,
      agoraAppId: process.env.AGORA_APP_ID || 'demo_agora_pashu_app_id',
      appointment: updated
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to start call.' });
  }
});

// POST /api/appointments/:id/accept-call (Farmer accepts incoming call)
router.post('/:id/accept-call', authenticate, (req, res) => {
  try {
    const existing = db.findById('appointments', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Appointment not found.' });

    const updated = db.updateById('appointments', req.params.id, {
      callStatus: 'active',
      callAcceptedAt: new Date().toISOString(),
      status: 'in_progress',
      updatedAt: new Date().toISOString()
    });

    return res.json({
      success: true,
      appointment: updated,
      agoraChannel: updated.agoraChannel || updated.callRoomId,
      agoraAppId: process.env.AGORA_APP_ID || 'demo_agora_pashu_app_id'
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to accept call.' });
  }
});

// POST /api/appointments/:id/end-call (Either party ends call)
router.post('/:id/end-call', authenticate, (req, res) => {
  try {
    const { callNotes, callDurationMinutes } = req.body;
    const existing = db.findById('appointments', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Appointment not found.' });

    const updated = db.updateById('appointments', req.params.id, {
      callStatus: 'completed',
      status: 'completed',
      callEndedAt: new Date().toISOString(),
      ...(callNotes ? { callNotes } : {}),
      ...(callDurationMinutes !== undefined ? { callDurationMinutes } : {}),
      updatedAt: new Date().toISOString()
    });

    return res.json({
      success: true,
      message: 'Call concluded.',
      appointment: updated
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to end call.' });
  }
});

// PATCH /api/appointments/:id
router.patch('/:id', authenticate, (req, res) => {
  try {
    const { status, callNotes, callDurationMinutes, callStatus } = req.body;
    const existing = db.findById('appointments', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Appointment not found.' });

    const updated = db.updateById('appointments', req.params.id, {
      ...(status ? { status } : {}),
      ...(callStatus ? { callStatus } : {}),
      ...(callNotes ? { callNotes } : {}),
      ...(callDurationMinutes !== undefined ? { callDurationMinutes } : {})
    });
    return res.json(updated);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update appointment.' });
  }
});

module.exports = router;
