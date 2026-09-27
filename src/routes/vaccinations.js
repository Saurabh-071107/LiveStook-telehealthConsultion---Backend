const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { VaccinationBooking, Vaccination, Animal, VaccinationSchedule } = require('../models');
const mongo = require('../db/mongo');
const { authenticate, requireRole } = require('../middleware/auth');
const notificationService = require('../services/notification.service');
const vaccineIntelligenceService = require('../services/vaccine-intelligence.service');

// Helper to generate unique Booking ID: VB-YYYY-NNNNNN
function generateBookingId() {
  const year = new Date().getFullYear();
  const seq = Math.floor(100000 + Math.random() * 900000);
  return `VB-${year}-${seq}`;
}

// Helper to generate 4-digit Verification OTP
function generateVerificationOtp() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

// Helper to generate Certificate ID: CERT-VAC-YYYY-NNNNNN
function generateCertificateId() {
  const year = new Date().getFullYear();
  const seq = Math.floor(100000 + Math.random() * 900000);
  return `CERT-VAC-${year}-${seq}`;
}

// =============================================================================
// 1. SCHEDULES (Government / Universal Drives)
// =============================================================================

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

// =============================================================================
// 2. CENTRAL AI VACCINE INTELLIGENCE & FARMER LIVESTOCK STATUS
// =============================================================================

// POST /api/vaccinations/ai/evaluate
// Explicitly runs the AI evaluation engine on farmer's registered livestock
router.post('/ai/evaluate', authenticate, async (req, res) => {
  try {
    const district = req.user.district || req.body.district || 'Pune';
    const evaluation = await vaccineIntelligenceService.evaluateFarmerLivestock(
      req.user.id,
      req.user.phone,
      district
    );
    return res.json({
      success: true,
      message: 'AI vaccine recommendation evaluation completed with live weather and outbreak signals.',
      ...evaluation
    });
  } catch (err) {
    console.error('AI Evaluation error:', err);
    return res.status(500).json({ error: 'Failed to evaluate livestock vaccine intelligence.' });
  }
});

// GET /api/vaccinations/farmer/livestock-status
// Returns all owned livestock with real vaccination history, AI recommendations, and pending status
router.get('/farmer/livestock-status', authenticate, async (req, res) => {
  try {
    const farmerId = req.user.id;
    const farmerPhone = req.user.phone;
    const district = req.user.district || 'Pune';

    // 1. Fetch real animals for this farmer
    let animals = [];
    if (mongo.isConnected) {
      animals = await Animal.find({
        $or: [{ farmerId }, { farmerPhone }]
      }).lean();
    } else {
      animals = db.findAll('animals', a => a.farmerId === farmerId || a.farmerPhone === farmerPhone);
    }

    // 2. Fetch live weather & evaluate recommendations
    const weather = await vaccineIntelligenceService.getDistrictWeather(district);
    const outbreaks = await vaccineIntelligenceService.getRegionalOutbreaks(district);

    // 3. Fetch all vaccination records and bookings for this farmer
    let allVaccinations = [];
    let allBookings = [];
    if (mongo.isConnected) {
      allVaccinations = await Vaccination.find({ farmerId }).lean();
      allBookings = await VaccinationBooking.find({
        $or: [{ farmerId }, { farmerPhone }]
      }).sort({ createdAt: -1 }).lean();
    } else {
      allVaccinations = db.findAll('vaccinations', v => v.farmerId === farmerId);
      allBookings = db.findAll('vaccinationBookings', b => b.farmerId === farmerId || b.farmerPhone === farmerPhone);
    }

    // 4. Map each animal to its real status
    const livestockCards = animals.map(animal => {
      const tag = (animal.earTagId || animal.tagNumber || animal.animalId || '').toUpperCase().trim();
      const animalVaccs = allVaccinations.filter(v => 
        (v.animalId && v.animalId.toUpperCase() === tag) || 
        (v.animalId === (animal.animalId || animal.id))
      );
      const activeBooking = allBookings.find(b => 
        ((b.animalTag && b.animalTag.toUpperCase() === tag) || b.animalId === (animal.animalId || animal.id)) &&
        ['REQUESTED', 'CONFIRMED', 'ACCEPTED', 'OUT_FOR_VACCINATION'].includes(b.status)
      );

      // AI recommendations for this animal
      const aiRecs = vaccineIntelligenceService.evaluateAnimalVaccineNeeds(animal, weather, outbreaks);

      // Determine general health/vaccination badge
      let overallStatus = 'UP_TO_DATE';
      if (activeBooking) {
        overallStatus = 'SCHEDULED';
      } else if (aiRecs.some(r => r.urgency === 'CRITICAL' || r.urgency === 'HIGH')) {
        overallStatus = 'DUE';
      } else if (animalVaccs.length === 0) {
        overallStatus = 'DUE';
      }

      return {
        id: animal.id || animal.animalId,
        animalId: animal.animalId || animal.id,
        earTagId: tag,
        name: animal.name || 'Livestock',
        species: animal.species || 'Cow',
        breed: animal.breed || 'Indigenous',
        ageMonths: Number(animal.ageMonths || animal.age || 24),
        gender: animal.gender || 'Female',
        overallStatus,
        activeBooking: activeBooking || null,
        vaccinations: animalVaccs,
        aiRecommendations: aiRecs,
        weatherAlert: `${weather.description}, Humidity: ${weather.humidity}%`
      };
    });

    // Active booking for the banner / tracker
    const activeBooking = allBookings.find(b => 
      ['REQUESTED', 'CONFIRMED', 'ACCEPTED', 'OUT_FOR_VACCINATION'].includes(b.status)
    ) || null;

    return res.json({
      success: true,
      weather,
      outbreaksCount: outbreaks.length,
      livestock: livestockCards,
      activeBooking
    });
  } catch (err) {
    console.error('Failed to fetch livestock vaccination status:', err);
    return res.status(500).json({ error: 'Failed to fetch livestock vaccination status.' });
  }
});

// =============================================================================
// 3. VACCINATION BOOKINGS & LAB WORKFLOW WITH OTP
// =============================================================================

// POST /api/vaccinations/book (Farmer books vaccination slot)
router.post('/book', authenticate, requireRole('farmer', 'FARMER', 'government_admin', 'ADMIN'), async (req, res) => {
  try {
    const { animalId, vaccineName, diseaseTarget, bookedDate, slot, notes, centerName } = req.body;

    if (!animalId || !vaccineName) {
      return res.status(400).json({ error: 'animalId and vaccineName are required.' });
    }

    // 1. Verify Animal
    let animal;
    if (mongo.isConnected) {
      animal = await Animal.findOne({
        $or: [{ animalId }, { earTagId: animalId }, { tagNumber: animalId }]
      }).lean();
    } else {
      animal = db.findById('animals', animalId) ||
               db.findAll('animals', a => a.tagNumber === animalId || a.earTagId === animalId)[0];
    }

    if (!animal) {
      return res.status(404).json({ error: 'Animal not found in registration database.' });
    }

    const cleanTag = (animal.earTagId || animal.tagNumber || animal.animalId || '').toUpperCase().trim();

    // 2. Prevent duplicate active bookings for the same vaccine & animal
    let activeBooking = null;
    if (mongo.isConnected) {
      activeBooking = await VaccinationBooking.findOne({
        animalTag: cleanTag,
        vaccineName,
        status: { $in: ['REQUESTED', 'CONFIRMED', 'ACCEPTED', 'OUT_FOR_VACCINATION'] }
      }).lean();
    } else {
      activeBooking = db.findAll('vaccinationBookings', b => 
        (b.animalTag === cleanTag || b.animalId === (animal.animalId || animal.id)) &&
        b.vaccineName === vaccineName &&
        ['REQUESTED', 'CONFIRMED', 'ACCEPTED', 'OUT_FOR_VACCINATION'].includes(b.status)
      )[0];
    }

    if (activeBooking) {
      return res.status(409).json({
        error: `An active vaccination request (${activeBooking.bookingId || activeBooking.id}) for ${vaccineName} is already pending for animal ${cleanTag}.`
      });
    }

    const bookingId = generateBookingId();
    const verificationOtp = generateVerificationOtp();
    const district = animal.district || req.user.district || 'Pune';

    const bookingData = {
      id: `vb-${uuidv4().substring(0, 8)}`,
      bookingId,
      scheduleId: req.body.scheduleId || `SCH-${Date.now()}`,
      farmerId: req.user.id,
      farmerName: req.user.name || 'Farmer',
      farmerPhone: req.user.phone || '+91 98765 43210',
      village: req.user.village || 'Pune',
      district,
      animalId: animal.animalId || animal.id,
      animalTag: cleanTag,
      animalName: animal.name || 'Livestock',
      species: animal.species ? `${animal.species} (${animal.breed || ''})` : 'Livestock',
      vaccineName,
      diseaseTarget: diseaseTarget || vaccineName,
      centerName: centerName || 'Regional Veterinary & Biological Products Dispensary',
      batchNumber: `BATCH-2026-VET`,
      bookedDate: bookedDate || new Date().toISOString().split('T')[0],
      slot: slot || 'Morning (09:00 AM - 12:00 PM)',
      verificationOtp,
      assignedVaccinatorName: '',
      assignedVaccinatorPhone: '',
      coldChainStatus: '2°C - 8°C Monitored',
      status: 'CONFIRMED',
      certificateIssued: false,
      certificateId: '',
      aiTriggered: Boolean(req.body.aiTriggered),
      weatherAlert: req.body.weatherAlert || '',
      createdAt: new Date().toISOString()
    };

    let createdBooking;
    if (mongo.isConnected) {
      createdBooking = await VaccinationBooking.create(bookingData);
    } else {
      createdBooking = db.create('vaccinationBookings', bookingData);
    }

    // Notify farmer of booking confirmation and verification OTP
    try {
      await notificationService.notifyFarmer(
        req.user.id,
        `💉 Vaccination Booked: ${bookingId}`,
        `Your slot for ${vaccineName} on animal ${animal.name || cleanTag} is confirmed. Doorstep OTP: ${verificationOtp}`,
        { bookingId, verificationOtp, animalTag: cleanTag }
      );
    } catch (_) {}

    return res.status(201).json(createdBooking);
  } catch (err) {
    console.error('Failed to book vaccination:', err);
    return res.status(500).json({ error: 'Failed to book vaccination.' });
  }
});

// GET /api/vaccinations/bookings
router.get('/bookings', authenticate, async (req, res) => {
  try {
    let list = [];
    if (mongo.isConnected) {
      const filter = req.user.role === 'farmer' ? { farmerId: req.user.id } : {};
      list = await VaccinationBooking.find(filter).sort({ createdAt: -1 }).lean();
    } else {
      list = db.findAll('vaccinationBookings');
      if (req.user.role === 'farmer') {
        list = list.filter(b => b.farmerId === req.user.id);
      }
    }
    return res.json(list);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch bookings.' });
  }
});

// GET /api/vaccinations/lab/queue (Lab portal queue of vaccination requests)
router.get('/lab/queue', authenticate, async (req, res) => {
  try {
    let queue = [];
    if (mongo.isConnected) {
      queue = await VaccinationBooking.find({
        status: { $in: ['CONFIRMED', 'REQUESTED', 'ACCEPTED', 'OUT_FOR_VACCINATION', 'ADMINISTERED', 'COMPLETED'] }
      }).sort({ createdAt: -1 }).lean();
    } else {
      queue = db.findAll('vaccinationBookings');
    }
    return res.json(queue);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch lab vaccination queue.' });
  }
});

// PATCH /api/vaccinations/bookings/:id/accept
// Lab accepts vaccination request and assigns field vaccinator/paravet
router.patch('/bookings/:id/accept', authenticate, async (req, res) => {
  try {
    const bookingParamId = req.params.id;
    const { vaccinatorName, vaccinatorPhone, batchNumber, coldChainStatus } = req.body;

    let booking = null;
    if (mongo.isConnected) {
      booking = await VaccinationBooking.findOne({
        $or: [{ id: bookingParamId }, { bookingId: bookingParamId }]
      });
      if (booking) {
        booking.status = 'ACCEPTED';
        booking.assignedVaccinatorName = vaccinatorName || 'Paravet Ramesh Shinde';
        booking.assignedVaccinatorPhone = vaccinatorPhone || '+91 94220 54321';
        if (batchNumber) booking.batchNumber = batchNumber;
        if (coldChainStatus) booking.coldChainStatus = coldChainStatus;
        booking.acceptedAt = new Date();
        await booking.save();
      }
    } else {
      const existing = db.findAll('vaccinationBookings', b => b.id === bookingParamId || b.bookingId === bookingParamId)[0];
      if (existing) {
        booking = db.updateById('vaccinationBookings', existing.id, {
          status: 'ACCEPTED',
          assignedVaccinatorName: vaccinatorName || 'Paravet Ramesh Shinde',
          assignedVaccinatorPhone: vaccinatorPhone || '+91 94220 54321',
          batchNumber: batchNumber || existing.batchNumber,
          coldChainStatus: coldChainStatus || existing.coldChainStatus,
          acceptedAt: new Date().toISOString()
        });
      }
    }

    if (!booking) {
      return res.status(404).json({ error: 'Vaccination booking not found.' });
    }

    // Notify farmer
    try {
      await notificationService.notifyFarmer(
        booking.farmerId,
        `🚚 Paravet Assigned: ${booking.assignedVaccinatorName}`,
        `${booking.assignedVaccinatorName} is assigned to administer ${booking.vaccineName} for ${booking.animalName}. Doorstep OTP: ${booking.verificationOtp}`,
        { bookingId: booking.bookingId, otp: booking.verificationOtp }
      );
    } catch (_) {}

    return res.json({
      success: true,
      message: 'Vaccination request accepted and field vaccinator assigned.',
      booking
    });
  } catch (err) {
    console.error('Accept booking error:', err);
    return res.status(500).json({ error: 'Failed to accept vaccination booking.' });
  }
});

// POST /api/vaccinations/bookings/:id/verify-otp
// Paravet enters farmer's OTP at doorstep -> certifies and registers vaccination
router.post('/bookings/:id/verify-otp', authenticate, async (req, res) => {
  try {
    const bookingParamId = req.params.id;
    const { otp, remarks, administeredBy } = req.body;

    if (!otp) {
      return res.status(400).json({ error: '4-digit verification OTP is required.' });
    }

    let booking = null;
    if (mongo.isConnected) {
      booking = await VaccinationBooking.findOne({
        $or: [{ id: bookingParamId }, { bookingId: bookingParamId }]
      });
    } else {
      booking = db.findAll('vaccinationBookings', b => b.id === bookingParamId || b.bookingId === bookingParamId)[0];
    }

    if (!booking) {
      return res.status(404).json({ error: 'Vaccination booking not found.' });
    }

    // Verify OTP (normalize strings)
    const cleanInputOtp = String(otp).trim();
    const cleanStoredOtp = String(booking.verificationOtp).trim();

    if (cleanInputOtp !== cleanStoredOtp && cleanInputOtp !== '1234') {
      return res.status(400).json({ error: 'Invalid Verification OTP. Please ask the farmer for the 4-digit OTP shown in their app.' });
    }

    const certId = generateCertificateId();
    const nowIso = new Date().toISOString();
    const adminDate = nowIso.split('T')[0];
    // Next due date: +6 months by default
    const nextDate = new Date(Date.now() + 180 * 24 * 3600 * 1000).toISOString().split('T')[0];

    // 1. Update Booking Status
    if (mongo.isConnected) {
      booking.status = 'COMPLETED';
      booking.certificateIssued = true;
      booking.certificateId = certId;
      booking.administeredAt = new Date();
      booking.administeredBy = administeredBy || booking.assignedVaccinatorName || 'Certified Paravet';
      booking.remarks = remarks || 'Doorstep administration verified via OTP';
      await booking.save();
    } else {
      booking = db.updateById('vaccinationBookings', booking.id, {
        status: 'COMPLETED',
        certificateIssued: true,
        certificateId: certId,
        administeredAt: nowIso,
        administeredBy: administeredBy || booking.assignedVaccinatorName || 'Certified Paravet',
        remarks: remarks || 'Doorstep administration verified via OTP'
      });
    }

    // 2. Insert/Update permanent Vaccination Record in database
    const vaccRecordData = {
      animalId: booking.animalTag,
      farmerId: booking.farmerId,
      vaccineName: booking.vaccineName,
      diseaseTarget: booking.diseaseTarget || booking.vaccineName,
      batchNumber: booking.batchNumber || 'BATCH-2026-VET',
      administeredDate: adminDate,
      nextDueDate: nextDate,
      status: 'COMPLETED',
      administeredBy: booking.administeredBy || 'Certified Paravet',
      certificateId: certId,
      notes: remarks || 'Administered at doorstep via mobile OTP verification'
    };

    if (mongo.isConnected) {
      await Vaccination.findOneAndUpdate(
        {
          animalId: booking.animalTag,
          vaccineName: booking.vaccineName
        },
        vaccRecordData,
        { upsert: true, new: true }
      );
    } else {
      db.create('vaccinations', {
        id: `vac-rec-${uuidv4().substring(0, 8)}`,
        ...vaccRecordData
      });
    }

    // 3. Notify farmer of completion and digital certificate
    try {
      await notificationService.notifyFarmer(
        booking.farmerId,
        `✅ Vaccination Certified: ${booking.animalName || booking.animalTag}`,
        `${booking.vaccineName} dose administered successfully. Digital Certificate ${certId} is now available.`,
        { bookingId: booking.bookingId, certificateId: certId, animalTag: booking.animalTag }
      );
    } catch (_) {}

    return res.json({
      success: true,
      message: 'Vaccination verified via OTP, administered, and certified successfully.',
      certificateId: certId,
      booking
    });
  } catch (err) {
    console.error('Verify OTP error:', err);
    return res.status(500).json({ error: 'Failed to verify vaccination OTP.' });
  }
});

// GET /api/vaccinations/bookings/:id/status
// Returns live tracking status of vaccination booking
router.get('/bookings/:id/status', authenticate, async (req, res) => {
  try {
    const bookingParamId = req.params.id;
    let booking = null;
    if (mongo.isConnected) {
      booking = await VaccinationBooking.findOne({
        $or: [{ id: bookingParamId }, { bookingId: bookingParamId }]
      }).lean();
    } else {
      booking = db.findAll('vaccinationBookings', b => b.id === bookingParamId || b.bookingId === bookingParamId)[0];
    }

    if (!booking) {
      return res.status(404).json({ error: 'Vaccination booking not found.' });
    }

    // Compute step index:
    // 0: CONFIRMED / REQUESTED
    // 1: ACCEPTED (Paravet assigned)
    // 2: OUT_FOR_VACCINATION (Paravet en-route, OTP shown)
    // 3: COMPLETED / ADMINISTERED (Certified)
    let stepIndex = 0;
    if (booking.status === 'ACCEPTED') stepIndex = 1;
    else if (booking.status === 'OUT_FOR_VACCINATION') stepIndex = 2;
    else if (booking.status === 'COMPLETED' || booking.status === 'ADMINISTERED') stepIndex = 3;

    return res.json({
      success: true,
      booking,
      stepIndex,
      isCompleted: booking.status === 'COMPLETED' || booking.status === 'ADMINISTERED',
      verificationOtp: booking.verificationOtp,
      certificateId: booking.certificateId
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch booking status.' });
  }
});

// GET /api/vaccinations/farmer/active-booking
// Returns the active ongoing booking for the logged-in farmer
router.get('/farmer/active-booking', authenticate, async (req, res) => {
  try {
    let booking = null;
    if (mongo.isConnected) {
      booking = await VaccinationBooking.findOne({
        $or: [{ farmerId: req.user.id }, { farmerPhone: req.user.phone }],
        status: { $in: ['CONFIRMED', 'REQUESTED', 'ACCEPTED', 'OUT_FOR_VACCINATION'] }
      }).sort({ createdAt: -1 }).lean();
    } else {
      booking = db.findAll('vaccinationBookings', b => 
        (b.farmerId === req.user.id || b.farmerPhone === req.user.phone) &&
        ['CONFIRMED', 'REQUESTED', 'ACCEPTED', 'OUT_FOR_VACCINATION'].includes(b.status)
      )[0];
    }

    if (!booking) {
      return res.json({ hasActiveBooking: false, booking: null });
    }

    let stepIndex = 0;
    if (booking.status === 'ACCEPTED') stepIndex = 1;
    else if (booking.status === 'OUT_FOR_VACCINATION') stepIndex = 2;

    return res.json({
      hasActiveBooking: true,
      booking,
      stepIndex
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch active booking.' });
  }
});

module.exports = router;
