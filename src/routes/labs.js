const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { Laboratory, TestBooking, TestReport, Case, Animal } = require('../models');
const { isConnected } = require('../db/mongo');
const { authenticate, requireRole } = require('../middleware/auth');
const notificationService = require('../services/notification.service');

// Helper to generate unique Booking ID: TB-YYYY-NNNNNN
function generateBookingId() {
  const year = new Date().getFullYear();
  const seq = Math.floor(100000 + Math.random() * 900000);
  return `TB-${year}-${seq}`;
}

// GET /api/labs (List available diagnostic laboratories)
router.get('/', authenticate, async (req, res) => {
  try {
    let labs = [];
    if (isConnected) {
      labs = await Laboratory.find({}).lean();
    } else {
      labs = db.findAll('laboratories');
    }

    // Default laboratories if collection empty
    if (!labs || labs.length === 0) {
      labs = [
        {
          id: 'lab-pune-central',
          code: 'LAB-PN-01',
          name: 'State Veterinary Biological Diagnostic Research Institute',
          address: 'Aundh Road, Ganeshkhind',
          district: 'Pune',
          state: 'Maharashtra',
          phone: '+91 20 2569 8811',
          testsOffered: ['RT-PCR (FMD/LSD)', 'Milk Somatic Cell Count (SCC)', 'California Mastitis Test (CMT)', 'Blood Parasite Smear', 'Antibiotic Sensitivity Test (AST)']
        },
        {
          id: 'lab-baramati-reg',
          code: 'LAB-BM-02',
          name: 'Regional Animal Health & Pathology Diagnostic Centre',
          address: 'MIDC Area, Baramati',
          district: 'Pune',
          state: 'Maharashtra',
          phone: '+91 2112 243900',
          testsOffered: ['Fecal Egg Count (FEC)', 'Complete Blood Count (CBC)', 'Serum Biochemistry', 'Brucella Abortus Plate Agglutination']
        }
      ];
    }

    return res.json(labs);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch diagnostic laboratories.' });
  }
});

// GET /api/labs/slots (Available time slots for a given date and laboratory)
router.get('/slots', authenticate, (req, res) => {
  try {
    const { labId, date } = req.query;
    const targetDate = date || new Date().toISOString().split('T')[0];

    // Standard hourly laboratory testing slots
    const standardSlots = [
      { slotId: `${targetDate}_0900`, time: '09:00 AM - 10:00 AM', capacity: 3 },
      { slotId: `${targetDate}_1000`, time: '10:00 AM - 11:00 AM', capacity: 3 },
      { slotId: `${targetDate}_1100`, time: '11:00 AM - 12:00 PM', capacity: 3 },
      { slotId: `${targetDate}_1400`, time: '02:00 PM - 03:00 PM', capacity: 3 },
      { slotId: `${targetDate}_1500`, time: '03:00 PM - 04:00 PM', capacity: 3 },
      { slotId: `${targetDate}_1600`, time: '04:00 PM - 05:00 PM', capacity: 3 },
    ];

    // Check existing bookings to compute availability
    const bookings = db.findAll('testBookings', b => b.date === targetDate && (!labId || b.laboratoryId === labId));

    const enrichedSlots = standardSlots.map(slot => {
      const bookedCount = bookings.filter(b => b.slotId === slot.slotId && b.status !== 'CANCELLED').length;
      return {
        ...slot,
        bookedCount,
        available: bookedCount < slot.capacity
      };
    });

    return res.json({ date: targetDate, slots: enrichedSlots });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch slots.' });
  }
});

// POST /api/labs/book (Farmer books diagnostic test for any owned animal with duplicate active test prevention)
router.post('/book', authenticate, requireRole('farmer', 'FARMER', 'government_admin', 'ADMIN'), async (req, res) => {
  try {
    const { animalId, testType, laboratoryId, labName, date, slotId, slotTime, caseId, notes } = req.body;

    if (!animalId || !testType) {
      return res.status(400).json({ error: 'animalId and testType are required.' });
    }

    // 1. Verify Animal in MongoDB Atlas
    let animal;
    if (isConnected) {
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

    const cleanTag = (animal.earTagId || animal.tagNumber || '').toUpperCase().trim();

    // 2. REQUIREMENT 3: A farmer cannot book another test of the same type for the same animal until the 1st is done!
    let activeTest = null;
    if (isConnected) {
      activeTest = await TestBooking.findOne({
        animalTag: cleanTag,
        testType: testType,
        status: { $in: ['TEST_BOOKED', 'TEST_IN_PROGRESS', 'SAMPLE_COLLECTED'] }
      }).lean();
    } else {
      activeTest = db.findAll('testBookings', b => 
        (b.animalTag === cleanTag || b.animalId === (animal.animalId || animal.id)) &&
        b.testType === testType &&
        ['TEST_BOOKED', 'TEST_IN_PROGRESS', 'SAMPLE_COLLECTED'].includes(b.status)
      )[0];
    }

    if (activeTest) {
      return res.status(409).json({
        error: `An active ${testType} (${activeTest.bookingId || activeTest.id}) is already in progress for animal ${cleanTag}. Another test of the same type cannot be booked until the current test report is completed.`
      });
    }

    const bookingId = generateBookingId();
    const targetDistrict = animal.district || req.user.district || 'Pune';
    const resolvedLabId = laboratoryId || (targetDistrict.toLowerCase() === 'baramati' ? 'lab-baramati-reg' : 'lab-pune-central');
    const resolvedLabName = labName || (resolvedLabId === 'lab-baramati-reg' 
      ? 'Regional Animal Health & Pathology Diagnostic Centre' 
      : 'State Veterinary Biological Diagnostic Research Institute');

    const bookingDoc = {
      id: bookingId,
      bookingId,
      testBookingId: bookingId,
      farmerId: req.user._id || req.user.id,
      farmerName: req.user.name || 'Farmer',
      farmerPhone: req.user.phone || '',
      animalId: animal.animalId || animal.id || animal._id.toString(),
      animalTag: cleanTag,
      animalType: `${animal.species || 'Cattle'} (${animal.breed || 'Cross'})`,
      caseId: caseId || null,
      laboratoryId: resolvedLabId,
      labName: resolvedLabName,
      district: targetDistrict,
      testType,
      date: date || new Date().toISOString().split('T')[0],
      slotDate: date || new Date().toISOString().split('T')[0],
      slotId: slotId || `${date || 'today'}_1000`,
      slotTime: slotTime || '10:00 AM - 11:00 AM',
      notes: notes || '',
      status: 'TEST_BOOKED',
      createdAt: new Date().toISOString()
    };

    if (isConnected) {
      await TestBooking.create(bookingDoc);
      if (caseId) {
        await Case.findOneAndUpdate({ caseId }, { status: 'TEST_BOOKED' });
      }
    }

    db.create('testBookings', bookingDoc);

    // Broadcast real-time WebSocket events to Lab and Government Admin
    const io = req.app.get('io');
    if (io) {
      io.emit('kpi_update', { type: 'TEST_BOOKED', bookingId });
      io.emit('lab_queue_update', { type: 'NEW_BOOKING', bookingId });
    }

    return res.status(201).json({
      success: true,
      message: `Diagnostic slot successfully booked for ${cleanTag}. Tracking ID: ${bookingId}`,
      booking: bookingDoc
    });
  } catch (err) {
    console.error('Test booking error:', err);
    return res.status(500).json({ error: 'Failed to book diagnostic test slot.' });
  }
});

// GET /api/labs/staff/queue (Lab Staff Test Queue from MongoDB Atlas)
router.get('/staff/queue', authenticate, async (req, res) => {
  try {
    const { status, testType } = req.query;
    let list = [];

    if (isConnected) {
      const query = {};
      if (status && status !== 'ALL') query.status = status;
      if (testType) query.testType = new RegExp(testType, 'i');
      list = await TestBooking.find(query).sort({ createdAt: -1 }).lean();
    } else {
      list = db.findAll('testBookings');
      if (status && status !== 'ALL') list = list.filter(b => b.status === status);
      if (testType) list = list.filter(b => b.testType.toLowerCase().includes(testType.toLowerCase()));
    }

    return res.json(list);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve laboratory queue.' });
  }
});

// PATCH /api/labs/tests/:id/start (Lab staff starts diagnostic test processing)
router.patch('/tests/:id/start', authenticate, requireRole('lab_staff', 'LAB_STAFF', 'admin', 'ADMIN', 'government_admin'), async (req, res) => {
  try {
    let updated = null;

    if (isConnected) {
      updated = await TestBooking.findOneAndUpdate(
        { $or: [{ bookingId: req.params.id }, { id: req.params.id }] },
        {
          status: 'TEST_IN_PROGRESS',
          startedAt: new Date(),
          staffId: req.user._id ? req.user._id.toString() : req.user.id,
          staffName: req.user.name || 'Laboratory Pathologist'
        },
        { new: true }
      ).lean();
    }

    const existing = db.findById('testBookings', req.params.id) ||
                     db.findAll('testBookings', b => b.bookingId === req.params.id)[0];
    if (existing) {
      db.updateById('testBookings', existing.id, {
        status: 'TEST_IN_PROGRESS',
        startedAt: new Date().toISOString(),
        staffId: req.user.id,
        staffName: req.user.name
      });
      if (existing.caseId) {
        db.updateById('cases', existing.caseId, { status: 'TEST_IN_PROGRESS' });
      }
    }

    const io = req.app.get('io');
    if (io) {
      io.emit('lab_queue_update', { type: 'TEST_STARTED', id: req.params.id });
    }

    return res.json({
      success: true,
      message: 'Diagnostic test in progress.',
      booking: updated || existing
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to start test processing.' });
  }
});

// POST /api/labs/tests/:id/upload-report (Lab staff uploads report & marks REPORT_AVAILABLE)
router.post('/tests/:id/upload-report', authenticate, requireRole('lab_staff', 'LAB_STAFF', 'admin', 'ADMIN', 'government_admin'), async (req, res) => {
  try {
    const {
      testResult,
      resultSummary,
      parameters = {},
      reportFileUrl = '',
      observations = '',
      isAbnormal = false
    } = req.body;

    let existingBooking = null;
    if (isConnected) {
      existingBooking = await TestBooking.findOne({
        $or: [{ bookingId: req.params.id }, { id: req.params.id }]
      });
    }

    if (!existingBooking) {
      existingBooking = db.findById('testBookings', req.params.id) ||
                        db.findAll('testBookings', b => b.bookingId === req.params.id)[0];
    }

    if (!existingBooking) return res.status(404).json({ error: 'Test booking record not found.' });

    const reportId = `RPT-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;

    const reportDoc = {
      id: reportId,
      reportId,
      bookingId: existingBooking.bookingId || existingBooking.id,
      testBookingId: existingBooking.bookingId || existingBooking.id,
      animalId: existingBooking.animalId,
      animalTag: existingBooking.animalTag,
      caseId: existingBooking.caseId,
      testType: existingBooking.testType,
      testResult: testResult || 'Completed',
      resultSummary: resultSummary || 'Normal / Negative',
      parameters,
      reportFileUrl: reportFileUrl || '/uploads/reports/sample_pathology_report.pdf',
      observations: observations || 'Verified by official laboratory technologist.',
      isAbnormal: Boolean(isAbnormal),
      finalizedBy: req.user.name || 'Laboratory Technologist',
      staffName: req.user.name || 'Laboratory Technologist',
      finalizedAt: new Date()
    };

    if (isConnected) {
      await TestReport.create(reportDoc);
      existingBooking.status = 'REPORT_AVAILABLE';
      existingBooking.reportId = reportId;
      existingBooking.report = reportDoc;
      existingBooking.completedAt = new Date();
      await existingBooking.save();

      if (existingBooking.caseId) {
        await Case.findOneAndUpdate({ caseId: existingBooking.caseId }, { status: 'REPORT_AVAILABLE' });
      }
    }

    db.create('testReports', reportDoc);
    if (existingBooking.id) {
      db.updateById('testBookings', existingBooking.id, {
        status: 'REPORT_AVAILABLE',
        reportId,
        report: reportDoc,
        completedAt: new Date().toISOString()
      });
    }

    // Broadcast WebSocket updates
    const io = req.app.get('io');
    if (io) {
      io.emit('kpi_update', { type: 'REPORT_UPLOADED', reportId });
      io.emit('lab_queue_update', { type: 'REPORT_UPLOADED', reportId });
    }

    return res.status(201).json({
      success: true,
      message: 'Laboratory report successfully uploaded and marked REPORT_AVAILABLE.',
      report: reportDoc
    });
  } catch (err) {
    console.error('Report upload error:', err);
    return res.status(500).json({ error: 'Failed to upload diagnostic report.' });
  }
});

// GET /api/labs/animal/:tag/reports (Retrieve all completed reports for an animal by ear tag)
router.get('/animal/:tag/reports', authenticate, async (req, res) => {
  try {
    const cleanTag = req.params.tag.trim().toUpperCase();
    let reports = [];

    if (isConnected) {
      reports = await TestReport.find({ animalTag: cleanTag }).sort({ createdAt: -1 }).lean();
    } else {
      reports = db.findAll('testReports', r => (r.animalTag && r.animalTag.toUpperCase() === cleanTag) || r.animalId === cleanTag);
    }

    return res.json(reports);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch animal reports.' });
  }
});

// GET /api/labs/tests/:id/report (View finalized report)
router.get('/tests/:id/report', authenticate, async (req, res) => {
  try {
    let report = null;
    if (isConnected) {
      report = await TestReport.findOne({
        $or: [{ bookingId: req.params.id }, { reportId: req.params.id }, { id: req.params.id }]
      }).lean();
    }

    if (!report) {
      report = db.findById('testReports', req.params.id) ||
               db.findAll('testReports', r => r.bookingId === req.params.id || r.reportId === req.params.id)[0];
    }

    if (!report) return res.status(404).json({ error: 'Report not found.' });
    return res.json(report);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve test report.' });
  }
});

module.exports = router;
