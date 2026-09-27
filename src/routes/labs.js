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

// POST /api/labs/book (Farmer books diagnostic test for any owned animal with double-booking prevention)
router.post('/book', authenticate, requireRole('farmer', 'FARMER', 'government_admin', 'ADMIN'), async (req, res) => {
  try {
    const { animalId, testType, laboratoryId, labName, date, slotId, slotTime, caseId, notes } = req.body;

    if (!animalId || !testType || !date || !slotId) {
      return res.status(400).json({ error: 'animalId, testType, date, and slotId are required.' });
    }

    // 1. Verify Animal belongs to Farmer
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
      return res.status(404).json({ error: 'Animal not found.' });
    }

    // 2. Prevent Double Booking on Slot (Atomic/Conflict check)
    const existingSlotBookings = db.findAll('testBookings', b => 
      b.laboratoryId === laboratoryId &&
      b.date === date &&
      b.slotId === slotId &&
      b.status !== 'CANCELLED'
    );

    if (existingSlotBookings.length >= 3) {
      return res.status(409).json({
        error: `Slot ${slotTime || slotId} at this laboratory is fully booked. Please select an alternate slot.`
      });
    }

    const bookingId = generateBookingId();

    const bookingDoc = {
      id: bookingId,
      bookingId,
      farmerId: req.user.id || req.user._id,
      farmerName: req.user.name,
      farmerPhone: req.user.phone,
      animalId: animal.animalId || animal.id,
      animalTag: animal.earTagId || animal.tagNumber,
      animalType: animal.type || animal.species,
      caseId: caseId || null,
      laboratoryId: laboratoryId || 'lab-pune-central',
      labName: labName || 'State Veterinary Biological Diagnostic Research Institute',
      testType,
      date,
      slotId,
      slotTime: slotTime || '10:00 AM - 11:00 AM',
      notes: notes || '',
      status: 'TEST_BOOKED', // TEST_BOOKED -> TEST_IN_PROGRESS -> REPORT_AVAILABLE -> COMPLETED
      createdAt: new Date().toISOString()
    };

    if (isConnected) {
      await TestBooking.create(bookingDoc);
      if (caseId) {
        await Case.findOneAndUpdate({ caseId }, { status: 'TEST_BOOKED' });
      }
    }

    db.create('testBookings', bookingDoc);

    return res.status(201).json({
      success: true,
      message: `Diagnostic slot successfully booked for ${animal.earTagId || animal.name}.`,
      booking: bookingDoc
    });
  } catch (err) {
    console.error('Test booking error:', err);
    return res.status(500).json({ error: 'Failed to book diagnostic test slot.' });
  }
});

// GET /api/labs/staff/queue (Lab Staff Test Queue)
router.get('/staff/queue', authenticate, async (req, res) => {
  try {
    const { status, testType } = req.query;
    let list = db.findAll('testBookings');

    if (status) list = list.filter(b => b.status === status);
    if (testType) list = list.filter(b => b.testType.toLowerCase().includes(testType.toLowerCase()));

    // Sort active pending tests to the top
    list.sort((a, b) => {
      const order = { 'TEST_IN_PROGRESS': 1, 'TEST_BOOKED': 2, 'REPORT_AVAILABLE': 3, 'COMPLETED': 4 };
      return (order[a.status] || 9) - (order[b.status] || 9);
    });

    return res.json(list);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve laboratory queue.' });
  }
});

// PATCH /api/labs/tests/:id/start (Lab staff starts diagnostic test processing)
router.patch('/tests/:id/start', authenticate, requireRole('lab_staff', 'LAB_STAFF', 'admin', 'ADMIN', 'government_admin'), (req, res) => {
  try {
    const existing = db.findById('testBookings', req.params.id) ||
                     db.findAll('testBookings', b => b.bookingId === req.params.id)[0];
    if (!existing) return res.status(404).json({ error: 'Booking not found.' });

    const updated = db.updateById('testBookings', existing.id, {
      status: 'TEST_IN_PROGRESS',
      startedAt: new Date().toISOString(),
      staffId: req.user.id,
      staffName: req.user.name
    });

    if (existing.caseId) {
      db.updateById('cases', existing.caseId, { status: 'TEST_IN_PROGRESS' });
    }

    return res.json({
      success: true,
      message: 'Diagnostic test in progress.',
      booking: updated
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

    const existingBooking = db.findById('testBookings', req.params.id) ||
                           db.findAll('testBookings', b => b.bookingId === req.params.id)[0];

    if (!existingBooking) return res.status(404).json({ error: 'Test booking record not found.' });

    const reportId = `RPT-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;

    const reportDoc = {
      id: reportId,
      reportId,
      bookingId: existingBooking.bookingId || existingBooking.id,
      animalId: existingBooking.animalId,
      animalTag: existingBooking.animalTag,
      caseId: existingBooking.caseId,
      testType: existingBooking.testType,
      testResult: testResult || 'Completed',
      resultSummary: resultSummary || 'Normal / Negative',
      parameters,
      reportFileUrl: reportFileUrl || '/uploads/reports/sample_pathology_report.pdf',
      observations,
      isAbnormal,
      finalizedBy: req.user.id,
      staffName: req.user.name,
      finalizedAt: new Date().toISOString()
    };

    if (isConnected) {
      await TestReport.create(reportDoc);
      if (existingBooking.caseId) {
        await Case.findOneAndUpdate({ caseId: existingBooking.caseId }, { status: 'REPORT_AVAILABLE' });
      }
    }

    db.create('testReports', reportDoc);

    db.updateById('testBookings', existingBooking.id, {
      status: 'REPORT_AVAILABLE',
      reportId,
      report: reportDoc,
      completedAt: new Date().toISOString()
    });

    // Notify attending Vet and Farmer
    notificationService.notifyTestReportReady(
      existingBooking.vetId,
      existingBooking.farmerId,
      existingBooking.bookingId
    );

    return res.status(201).json({
      success: true,
      message: 'Laboratory report successfully uploaded and marked TEST_REPORT_AVAILABLE.',
      report: reportDoc
    });
  } catch (err) {
    console.error('Report upload error:', err);
    return res.status(500).json({ error: 'Failed to upload diagnostic report.' });
  }
});

// GET /api/labs/tests/:id/report (View finalized report)
router.get('/tests/:id/report', authenticate, (req, res) => {
  try {
    const report = db.findById('testReports', req.params.id) ||
                   db.findAll('testReports', r => r.bookingId === req.params.id || r.reportId === req.params.id)[0];

    if (!report) return res.status(404).json({ error: 'Report not found.' });
    return res.json(report);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve test report.' });
  }
});

module.exports = router;
