const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authenticate } = require('../middleware/auth');

// GET /api/appointments
router.get('/', authenticate, (req, res) => {
  try {
    let list = db.findAll('appointments');
    // Exclude live queue tickets - they belong strictly in /api/appointments/vet-queue
    list = list.filter(a => a.status !== 'in_queue' && !a.queueToken && !a.tokenNumber);

    if (req.user.role === 'farmer') {
      list = list.filter(a => a.farmerId === req.user.id);
    } else if (req.user.role === 'vet') {
      list = list.filter(a => 
        a.vetId === req.user.id || 
        !a.vetId
      );
    }
    list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
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

// POST /api/appointments/queue-call (Instant Queue Triage Registration with Single-Queue Enforcement)
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

    // 1. Single-Queue Enforcement: Check if farmer is already in a queue
    const existingActiveQueue = db.findAll('appointments', a =>
      a.farmerId === req.user.id &&
      a.status === 'in_queue' &&
      (a.callStatus === 'waiting' || a.callStatus === 'ringing' || a.callStatus === 'active')
    )[0];

    if (existingActiveQueue) {
      return res.status(400).json({
        error: `You are already in the queue for ${existingActiveQueue.vetName} with Token ${existingActiveQueue.queueToken || 'Q-01'}. You cannot join multiple doctor queues simultaneously. Please leave your current queue first.`,
        existingQueue: existingActiveQueue
      });
    }

    const vet = db.findById('users', targetVetId) || db.findAll('users', u => u.role === 'vet')[0];
    const callRoomId = `agora-${uuidv4().substring(0, 10)}`;
    const parsedSymptoms = Array.isArray(symptoms) ? symptoms : (symptoms ? [symptoms] : []);
    const parsedPhotos = Array.isArray(photoUrls) ? photoUrls : (Array.isArray(photos) ? photos : []);

    // 2. Daily Sequential Token Generation per Vet (Q-01, Q-02...)
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);
    const todayVetQueue = db.findAll('appointments', a =>
      a.vetId === targetVetId &&
      new Date(a.createdAt || a.scheduledAt || Date.now()) >= todayMidnight
    );
    const tokenNumber = `Q-${String(todayVetQueue.length + 1).padStart(2, '0')}`;

    // 3. Calculate patients ahead and estimated wait time
    const activeAhead = db.findAll('appointments', a =>
      a.vetId === targetVetId &&
      a.status === 'in_queue' &&
      a.callStatus === 'waiting'
    ).length;
    const estimatedMinutes = (activeAhead + 1) * 3;

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
      queueToken: tokenNumber,
      tokenNumber: tokenNumber,
      queuePosition: activeAhead + 1,
      estimatedWaitMinutes: estimatedMinutes,
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

// GET /api/appointments/queue-status (Live Queue Token, currently serving, and estimated wait)
router.get('/queue-status', authenticate, (req, res) => {
  try {
    const activeQueue = db.findAll('appointments', a =>
      a.farmerId === req.user.id &&
      a.status === 'in_queue' &&
      (a.callStatus === 'waiting' || a.callStatus === 'ringing' || a.callStatus === 'active')
    )[0];

    if (!activeQueue) {
      return res.json({ inQueue: false });
    }

    // Find currently serving token for this vet
    const vetRingingOrActive = db.findAll('appointments', a =>
      a.vetId === activeQueue.vetId &&
      (a.callStatus === 'active' || a.callStatus === 'ringing')
    )[0];

    const waitingList = db.findAll('appointments', a =>
      a.vetId === activeQueue.vetId &&
      a.status === 'in_queue' &&
      a.callStatus === 'waiting'
    ).sort((x, y) => new Date(x.createdAt) - new Date(y.createdAt));

    const currentlyServing = vetRingingOrActive
      ? (vetRingingOrActive.queueToken || 'Q-01')
      : (waitingList[0] ? (waitingList[0].queueToken || 'Q-01') : (activeQueue.queueToken || 'Q-01'));

    const myIndex = waitingList.findIndex(a => a.id === activeQueue.id);
    const position = myIndex >= 0 ? myIndex : 0;
    const estimatedWaitMinutes = (position + 1) * 3;

    return res.json({
      inQueue: true,
      appointment: activeQueue,
      token: activeQueue.queueToken || 'Q-01',
      tokenNumber: activeQueue.queueToken || 'Q-01',
      currentlyServing: currentlyServing,
      position: position,
      patientsAhead: position,
      estimatedWaitMinutes: estimatedWaitMinutes,
      vetName: activeQueue.vetName,
      hospitalClinic: activeQueue.hospitalClinic,
      animalName: activeQueue.animalName,
      species: activeQueue.species,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve queue status.' });
  }
});

// POST /api/appointments/:id/leave-queue (Farmer leaves the queue)
router.post('/:id/leave-queue', authenticate, (req, res) => {
  try {
    const apt = db.findById('appointments', req.params.id);
    if (!apt) return res.status(404).json({ error: 'Queue appointment not found.' });

    if (apt.farmerId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized to leave this queue.' });
    }

    const updated = db.updateById('appointments', req.params.id, {
      status: 'cancelled',
      callStatus: 'cancelled',
      cancelledAt: new Date().toISOString()
    });

    return res.json({
      success: true,
      message: 'Successfully left the consultation queue.',
      appointment: updated
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to leave queue.' });
  }
});

// GET /api/appointments/vet-queue (Vet views strictly their assigned queued patients)
router.get('/vet-queue', authenticate, (req, res) => {
  try {
    const vetId = req.user.id;
    const queueList = db.findAll('appointments', a =>
      (a.vetId === vetId || !a.vetId) &&
      a.status === 'in_queue' &&
      (a.callStatus === 'waiting' || a.callStatus === 'ringing' || a.callStatus === 'active')
    ).sort((x, y) => new Date(x.createdAt) - new Date(y.createdAt));

    return res.json(queueList);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve vet queue.' });
  }
});

// POST /api/appointments/:id/accept-appointment (Vet accepts appointment & issues digital slip number)
router.post('/:id/accept-appointment', authenticate, (req, res) => {
  try {
    const apt = db.findById('appointments', req.params.id);
    if (!apt) return res.status(404).json({ error: 'Appointment not found.' });

    const appointmentNumber = `APT-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const updated = db.updateById('appointments', req.params.id, {
      status: 'accepted',
      appointmentNumber,
      acceptedAt: new Date().toISOString()
    });

    return res.json({
      success: true,
      message: 'Appointment accepted by doctor.',
      appointment: updated,
      appointmentNumber
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to accept appointment.' });
  }
});

// In-memory stream buffer for real-time video frame & audio transmission sync
const activeStreamSessions = new Map();

// GET /api/appointments/incoming-call (Poll / fetch ringing call for farmer)
router.get('/incoming-call', authenticate, (req, res) => {
  try {
    const list = db.findAll('appointments');
    const targetAptId = req.query.appointmentId;

    // Match strictly if callStatus === 'ringing' (Once accepted, it becomes 'active' / 'in_call' so it will NOT ring again!)
    const activeRinging = list.find(a => {
      const isTarget = targetAptId
        ? (a.id === targetAptId || a.queueToken === targetAptId || a.callRoomId?.includes(targetAptId) || a.agoraChannel?.includes(targetAptId))
        : true;
      const isFarmerMatch = a.farmerId === req.user.id || a.farmerPhone === req.user.phone || !a.farmerId;
      const isCallActive = (a.callStatus === 'ringing'); // Strictly ringing!
      const isRecent = !a.callStartedAt || (Date.now() - new Date(a.callStartedAt).getTime() < 5 * 60 * 1000);
      return (targetAptId ? isTarget : isFarmerMatch) && isCallActive && isRecent;
    });

    if (activeRinging) {
      const channel = activeRinging.agoraChannel || activeRinging.callRoomId || `agora-${activeRinging.id}`;
      return res.json({
        hasIncomingCall: true,
        appointment: activeRinging,
        agoraChannel: channel,
        agoraAppId: process.env.AGORA_APP_ID || 'demo_agora_pashu_app_id'
      });
    }

    return res.json({ hasIncomingCall: false });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to check incoming calls.' });
  }
});

// POST /api/appointments/:id/stream-frame (Transmit live video frame & audio metrics)
router.post('/:id/stream-frame', authenticate, (req, res) => {
  try {
    const aptId = req.params.id;
    const { role, frame, isAudioActive, isMuted, isVideoOff } = req.body;
    if (!activeStreamSessions.has(aptId)) {
      activeStreamSessions.set(aptId, {});
    }
    const session = activeStreamSessions.get(aptId);
    const resolvedRole = role || (req.user.role === 'vet' ? 'doctor' : 'farmer');
    session[resolvedRole] = {
      frame: frame || (session[resolvedRole]?.frame ?? null),
      isAudioActive: isAudioActive ?? true,
      isMuted: isMuted ?? false,
      isVideoOff: isVideoOff ?? false,
      timestamp: Date.now()
    };
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to record stream frame.' });
  }
});

// GET /api/appointments/:id/stream-frame (Receive peer's live video frame & audio metrics)
router.get('/:id/stream-frame', authenticate, (req, res) => {
  try {
    const aptId = req.params.id;
    const peerRole = req.query.peerRole || (req.user.role === 'vet' ? 'farmer' : 'doctor');
    const session = activeStreamSessions.get(aptId) || {};
    const peerData = session[peerRole] || null;
    return res.json({ success: true, peerRole, peerData });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve stream frame.' });
  }
});

// GET /api/appointments/:id (Get real-time appointment status & completion data)
router.get('/:id', authenticate, (req, res) => {
  try {
    let apt = db.findById('appointments', req.params.id);
    if (!apt) {
      apt = db.findAll('appointments', a =>
        a.id === req.params.id ||
        a.queueToken === req.params.id ||
        a.tokenNumber === req.params.id ||
        a.callRoomId?.includes(req.params.id) ||
        a.agoraChannel?.includes(req.params.id)
      )[0];
    }
    if (!apt) return res.status(404).json({ error: 'Appointment not found.' });
    return res.json(apt);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve appointment.' });
  }
});

// POST /api/appointments/:id/start-call (Doctor initiates Agora call - 5 min check enforced)
router.post('/:id/start-call', authenticate, (req, res) => {
  try {
    const targetId = req.params.id;
    let existing = db.findById('appointments', targetId);
    if (!existing) {
      existing = db.findAll('appointments', a =>
        a.id === targetId ||
        a.queueToken === targetId ||
        a.tokenNumber === targetId ||
        a.appointmentNumber === targetId ||
        a.callRoomId?.includes(targetId) ||
        a.agoraChannel?.includes(targetId)
      )[0];
    }
    // Fallback: If vet is starting call and there's a live in_queue ticket waiting
    if (!existing) {
      existing = db.findAll('appointments', a => a.status === 'in_queue' && a.callStatus === 'waiting')[0];
    }
    if (!existing) return res.status(404).json({ error: 'Appointment not found.' });

    // Enforce 5-minute pre-call rule for scheduled appointments only (never lock instant queue)
    if (existing.scheduledAt && existing.status !== 'in_queue' && !existing.queueToken && !existing.scheduledTime?.toLowerCase().includes('queue')) {
      const scheduledTime = new Date(existing.scheduledAt).getTime();
      const now = Date.now();
      const earliestAllowed = scheduledTime - 5 * 60 * 1000; // 5 mins before

      if (now < earliestAllowed) {
        const minsRemaining = Math.ceil((earliestAllowed - now) / 60000);
        return res.status(403).json({
          error: `Appointment room unlocks 5 minutes before scheduled time. Please wait ${minsRemaining} minute(s).`,
          unlocksInMinutes: minsRemaining
        });
      }
    }

    const agoraChannel = existing.callRoomId || existing.agoraChannel || `agora-${existing.id}`;
    const updated = db.updateById('appointments', existing.id, {
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

// POST /api/appointments/:id/end-call (STRICT RULE: Only Doctor can terminate clinical consultation)
router.post('/:id/end-call', authenticate, (req, res) => {
  try {
    const userRole = (req.user.role || '').toLowerCase();
    if (userRole !== 'vet' && userRole !== 'veterinarian' && userRole !== 'government_admin' && userRole !== 'admin') {
      return res.status(403).json({ error: 'Strict Rule: Only the attending veterinarian can conclude the clinical consultation and finalize prescriptions.' });
    }

    const { callNotes, callDurationMinutes } = req.body;
    let existing = db.findById('appointments', req.params.id);
    if (!existing) {
      existing = db.findAll('appointments', a =>
        a.id === req.params.id ||
        a.queueToken === req.params.id ||
        a.tokenNumber === req.params.id ||
        a.appointmentNumber === req.params.id ||
        a.callRoomId?.includes(req.params.id) ||
        a.agoraChannel?.includes(req.params.id)
      )[0];
    }
    if (!existing) {
      existing = db.findAll('appointments', a => (a.callStatus === 'active' || a.callStatus === 'ringing'))[0];
    }
    if (!existing) return res.status(404).json({ error: 'Appointment not found.' });

    const updated = db.updateById('appointments', existing.id, {
      callStatus: 'completed',
      status: 'completed',
      callEndedAt: new Date().toISOString(),
      ...(callNotes ? { callNotes } : {}),
      ...(callDurationMinutes !== undefined ? { callDurationMinutes } : {}),
      updatedAt: new Date().toISOString()
    });

    activeStreamSessions.delete(existing.id);

    return res.json({
      success: true,
      message: 'Call concluded and clinical record archived as completed.',
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
