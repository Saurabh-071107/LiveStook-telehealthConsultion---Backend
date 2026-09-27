const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcryptjs');
const { User, Veterinarian, Farmer, Animal, Case, Consultation, TestBooking, Vaccination, Outbreak, AuditLog } = require('../models');
const mongo = require('../db/mongo');
const { authenticate, requireRole } = require('../middleware/auth');
const medicalReportService = require('../services/medical-report.service');
const notificationService = require('../services/notification.service');
const aiSurveillanceService = require('../services/ai-surveillance.service');

// GET /api/admin/stats (Comprehensive KPIs for Government Dashboard)
router.get('/stats', authenticate, requireRole('government_admin', 'ADMIN', 'admin'), async (req, res) => {
  try {
    let vets = [];
    let cases = [];
    let animals = [];
    let farmers = [];
    let testBookings = [];
    let consultations = [];
    let outbreaks = [];

    if (mongo.isConnected) {
      [vets, cases, animals, farmers, testBookings, consultations, outbreaks] = await Promise.all([
        Veterinarian.find({}).lean(),
        Case.find({}).lean(),
        Animal.find({}).lean(),
        Farmer.find({}).lean(),
        TestBooking.find({}).lean(),
        Consultation.find({}).lean(),
        Outbreak.find({}).lean()
      ]);
    } else {
      vets = db.findAll('users', u => u.role === 'vet' || u.role === 'veterinarian');
      cases = db.findAll('cases');
      animals = db.findAll('animals');
      farmers = db.findAll('users', u => u.role === 'farmer');
      testBookings = db.findAll('testBookings');
      consultations = db.findAll('consultations');
      outbreaks = db.findAll('outbreaks');
    }

    const verifiedVets = vets.filter(v => v.verificationStatus === 'VERIFIED' || v.isApproved || v.verificationStatus === 'verified');
    const pendingVets = vets.filter(v => v.verificationStatus === 'PENDING' || (!v.isApproved && v.verificationStatus !== 'REJECTED'));
    const rejectedVets = vets.filter(v => v.verificationStatus === 'REJECTED');

    const activeCases = cases.filter(c => c.status !== 'CLOSED' && c.status !== 'resolved' && c.status !== 'COMPLETED');
    const completedCases = cases.filter(c => c.status === 'CLOSED' || c.status === 'resolved' || c.status === 'COMPLETED');

    const stats = {
      farmersCount: farmers.length,
      animalsCount: animals.length,
      totalVets: vets.length,
      verifiedVetsCount: verifiedVets.length,
      pendingVetsCount: pendingVets.length,
      rejectedVetsCount: rejectedVets.length,
      activeCasesCount: activeCases.length,
      completedCasesCount: completedCases.length,
      totalConsultations: consultations.length,
      totalLabTests: testBookings.length,
      activeOutbreaksCount: outbreaks.filter(o => o.riskCategory === 'HIGH' || o.riskCategory === 'CRITICAL' || o.quarantineActive).length,
      diseaseDistribution: {
        'Foot and Mouth Disease': cases.filter(c => (c.preliminaryCondition || '').includes('Foot') || (c.symptoms || []).includes('Blisters')).length,
        'Lumpy Skin Disease': cases.filter(c => (c.preliminaryCondition || '').includes('Lumpy') || (c.symptoms || []).includes('Lumps')).length,
        'Mastitis': cases.filter(c => (c.preliminaryCondition || '').includes('Mastitis') || (c.symptoms || []).includes('Milk')).length,
        'Bovine Respiratory Disease': cases.filter(c => (c.preliminaryCondition || '').includes('Respiratory') || (c.symptoms || []).includes('Cough')).length,
        'General Fever/Inappetence': cases.filter(c => (c.symptoms || []).includes('Fever')).length
      }
    };

    return res.json(stats);
  } catch (err) {
    console.error('Admin stats error:', err);
    return res.status(500).json({ error: 'Failed to aggregate admin statistics.' });
  }
});

// GET /api/admin/vets (List all vets with verification credentials from MongoDB)
router.get('/vets', authenticate, requireRole('government_admin', 'ADMIN', 'admin'), async (req, res) => {
  try {
    if (mongo.isConnected) {
      const vets = await Veterinarian.find({}).sort({ createdAt: -1 }).lean();
      const formatted = vets.map(v => ({
        id: v._id.toString(),
        userId: v.userId ? v.userId.toString() : '',
        doctorId: v.doctorId,
        name: v.name,
        phone: v.phone,
        email: v.email,
        qualification: v.qualification,
        specialization: v.specialization,
        certificateUrl: v.certificateUrl || '',
        hospitalClinic: v.hospitalClinic,
        district: v.district,
        state: v.state,
        verificationStatus: v.verificationStatus || 'PENDING',
        isApproved: v.verificationStatus === 'VERIFIED',
        assignedTempPassword: v.assignedTempPassword || '',
        rejectionReason: v.rejectionReason || '',
        verifiedAt: v.verifiedAt,
      }));
      return res.json(formatted);
    }

    const vets = db.findAll('users', u => u.role === 'vet' || u.role === 'veterinarian');
    const safeVets = vets.map(({ password, ...safe }) => safe);
    return res.json(safeVets);
  } catch (err) {
    console.error('Fetch vets list error:', err);
    return res.status(500).json({ error: 'Failed to fetch veterinarians list.' });
  }
});

// PATCH /api/admin/vets/:id/verify (Verify or reject veterinarian with reason)
router.patch('/vets/:id/verify', authenticate, requireRole('government_admin', 'ADMIN', 'admin'), async (req, res) => {
  try {
    const { status, rejectionReason = '', assignedPassword } = req.body; // 'VERIFIED', 'REJECTED', 'PENDING'
    const normalized = (status || '').toUpperCase();

    if (!['VERIFIED', 'REJECTED', 'PENDING'].includes(normalized)) {
      return res.status(400).json({ error: 'Valid status is VERIFIED, REJECTED, or PENDING.' });
    }

    if (mongo.isConnected) {
      let vet = null;
      const mongoose = require('mongoose');
      if (mongoose.Types.ObjectId.isValid(req.params.id)) {
        vet = await Veterinarian.findById(req.params.id);
      }
      if (!vet) {
        vet = await Veterinarian.findOne({
          $or: [{ doctorId: req.params.id }, { userId: req.params.id }, { email: req.params.id.toLowerCase() }],
        });
      }

      if (!vet) {
        return res.status(404).json({ error: 'Veterinarian profile not found.' });
      }

      let generatedPassword = '';
      if (normalized === 'VERIFIED') {
        const cleanDocId = vet.doctorId.replace(/[^a-zA-Z0-9]/g, '');
        generatedPassword = assignedPassword || `Vet@${cleanDocId || '2026'}`;
        const hashedPassword = bcrypt.hashSync(generatedPassword, 10);

        let user = null;
        if (vet.userId) {
          user = await User.findById(vet.userId);
        }
        if (!user && vet.email) {
          user = await User.findOne({ email: vet.email.toLowerCase() });
        }
        if (!user && vet.phone) {
          user = await User.findOne({ phone: vet.phone });
        }

        if (user) {
          user.role = 'VETERINARIAN';
          user.password = hashedPassword;
          user.name = vet.name;
          user.email = vet.email;
          user.isActive = true;
          await user.save();
        } else {
          user = await User.create({
            name: vet.name,
            email: vet.email.toLowerCase(),
            phone: vet.phone,
            password: hashedPassword,
            role: 'VETERINARIAN',
            isActive: true,
          });
        }

        vet.userId = user._id;
        vet.verificationStatus = 'VERIFIED';
        vet.isApproved = true;
        vet.assignedTempPassword = generatedPassword;
        vet.verifiedBy = req.user._id || req.user.id;
        vet.verifiedAt = new Date();
        vet.rejectionReason = '';
        await vet.save();
      } else if (normalized === 'REJECTED') {
        vet.verificationStatus = 'REJECTED';
        vet.isApproved = false;
        vet.rejectionReason = rejectionReason || 'Incomplete credentials';
        await vet.save();
      } else {
        vet.verificationStatus = 'PENDING';
        vet.isApproved = false;
        await vet.save();
      }

      await AuditLog.create({
        actorId: req.user._id || req.user.id,
        actorRole: 'ADMIN',
        action: `VET_VERIFICATION_${normalized}`,
        entityId: vet._id.toString(),
        details: { rejectionReason, doctorId: vet.doctorId, generatedPassword: normalized === 'VERIFIED' ? generatedPassword : null }
      });

      const io = req.app.get('io');
      if (io) {
        io.emit('kpi_update', { type: 'VET_STATUS_UPDATED', vetId: vet._id.toString(), status: normalized, timestamp: Date.now() });
      }

      return res.json({
        success: true,
        message: `Veterinarian status updated to ${normalized}.`,
        credentials: normalized === 'VERIFIED' ? { email: vet.email, password: generatedPassword } : null,
        vet: {
          id: vet._id.toString(),
          doctorId: vet.doctorId,
          name: vet.name,
          email: vet.email,
          verificationStatus: vet.verificationStatus,
          isApproved: vet.verificationStatus === 'VERIFIED',
          assignedTempPassword: vet.assignedTempPassword,
        },
      });
    }

    const vet = db.findById('users', req.params.id);
    if (!vet) {
      return res.status(404).json({ error: 'Veterinarian profile not found.' });
    }

    const cleanDocId = (vet.doctorId || '2026').replace(/[^a-zA-Z0-9]/g, '');
    const tempPassword = assignedPassword || `Vet@${cleanDocId}`;
    const updates = {
      verificationStatus: normalized,
      isApproved: normalized === 'VERIFIED',
      availableForCalls: normalized === 'VERIFIED',
      verifiedBy: req.user.id,
      verifiedAt: new Date().toISOString(),
      rejectionReason: normalized === 'REJECTED' ? rejectionReason : '',
      assignedTempPassword: normalized === 'VERIFIED' ? tempPassword : '',
      password: normalized === 'VERIFIED' ? bcrypt.hashSync(tempPassword, 10) : vet.password,
    };

    const updated = db.updateById('users', req.params.id, updates);
    const { password, ...safe } = updated;

    return res.json({
      success: true,
      message: `Veterinarian status updated to ${normalized}.`,
      credentials: normalized === 'VERIFIED' ? { email: updated.email, password: tempPassword } : null,
      vet: safe,
    });
  } catch (err) {
    console.error('Vet verification error:', err);
    return res.status(500).json({ error: 'Failed to update vet verification status.' });
  }
});

// GET /api/admin/reports/animal/:id (Export structured animal medical report)
router.get('/reports/animal/:id', authenticate, requireRole('government_admin', 'ADMIN', 'admin'), async (req, res) => {
  try {
    const history = await medicalReportService.getFullMedicalHistory(req.params.id);
    return res.json(history);
  } catch (err) {
    return res.status(404).json({ error: err.message });
  }
});

// GET /api/admin/audit-logs
router.get('/audit-logs', authenticate, requireRole('government_admin', 'ADMIN', 'admin'), async (req, res) => {
  try {
    let logs = [];
    if (mongo.isConnected) {
      logs = await AuditLog.find({}).sort({ createdAt: -1 }).limit(100).lean();
    } else {
      logs = db.findAll('auditLogs');
    }
    return res.json(logs);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch audit logs.' });
  }
});

// GET /api/admin/ai-surveillance (Major AI Disease Outbreak & Early Warning Intelligence)
router.get('/ai-surveillance', authenticate, requireRole('government_admin', 'ADMIN', 'admin'), async (req, res) => {
  try {
    const intelligence = await aiSurveillanceService.getSurveillanceIntelligence();
    return res.json(intelligence);
  } catch (err) {
    console.error('AI Surveillance error:', err);
    return res.status(500).json({ error: 'Failed to generate AI surveillance intelligence.' });
  }
});

// POST /api/admin/ai-surveillance/push-emergency-alert (Push emergency warning to farmers and doctors)
router.post('/ai-surveillance/push-emergency-alert', authenticate, requireRole('government_admin', 'ADMIN', 'admin'), async (req, res) => {
  try {
    const { village, panchayat, district, disease, probabilityPercent, severity, customMessage } = req.body;
    if (!disease || !village) {
      return res.status(400).json({ error: 'Disease and target village/panchayat are required.' });
    }

    const io = req.app.get('io');
    const result = await aiSurveillanceService.pushEmergencyAlert({
      village,
      panchayat,
      district,
      disease,
      probabilityPercent,
      severity,
      customMessage,
      io
    });

    return res.status(201).json(result);
  } catch (err) {
    console.error('Emergency alert push error:', err);
    return res.status(500).json({ error: 'Failed to dispatch emergency alert.' });
  }
});

// GET /api/admin/marketplace/listings (Fetch all farmer sell listings for Govt Verification)
router.get('/marketplace/listings', authenticate, requireRole('government_admin', 'ADMIN', 'admin'), (req, res) => {
  try {
    const { status, category } = req.query;
    let listings = db.findAll('sellListings');

    // If empty seed some initial listings for verification demo
    if (!listings || listings.length === 0) {
      const initial = [
        {
          id: 'sell-init-01',
          farmerId: 'farmer-01',
          farmerName: 'Rameshwar Patil',
          farmerPhone: '+91 98220 12345',
          title: 'Holstein Friesian (HF) Milking Cow - 18L/day',
          category: 'cow',
          expectedPrice: 65000,
          animalTag: 'ET-893421',
          description: 'High genetic merit crossbred cow, second lactation. Fully vaccinated against FMD and LSD.',
          photoUrl: 'assets/images/market_item_hf_cow.png',
          village: 'Khed, Pune',
          district: 'Pune',
          verificationStatus: 'PENDING',
          isGovVerified: false,
          healthCertificateTag: 'HC-2026-8812',
          createdAt: new Date(Date.now() - 3600 * 1000).toISOString()
        },
        {
          id: 'sell-init-02',
          farmerId: 'farmer-02',
          farmerName: 'Ganesh Deshmukh',
          farmerPhone: '+91 98221 23456',
          title: 'Pure Murrah Dairy Buffalo (1st Lactation)',
          category: 'buffalo',
          expectedPrice: 85000,
          animalTag: 'ET-771204',
          description: 'High fat yield Murrah buffalo. Dewormed and Brucellosis screened.',
          photoUrl: 'assets/images/market_item_murrah_buffalo.png',
          village: 'Sinnar, Nashik',
          district: 'Nashik',
          verificationStatus: 'VERIFIED',
          isGovVerified: true,
          healthCertificateTag: 'HC-2026-6204',
          verifiedAt: new Date(Date.now() - 12 * 3600 * 1000).toISOString(),
          createdAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString()
        },
        {
          id: 'sell-init-03',
          farmerId: 'farmer-03',
          farmerName: 'Tanaji Jadhav',
          farmerPhone: '+91 98224 56789',
          title: 'Pure Kathiawadi Gir Cow (A2 Milk)',
          category: 'cow',
          expectedPrice: 72000,
          animalTag: 'ET-550192',
          description: 'Indigenous Gir cow with docile temperament. 14L daily milk production.',
          photoUrl: 'assets/images/market_item_gir_cow.png',
          village: 'Karad, Satara',
          district: 'Satara',
          verificationStatus: 'PENDING',
          isGovVerified: false,
          healthCertificateTag: 'HC-2026-4410',
          createdAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString()
        }
      ];
      initial.forEach(l => db.create('sellListings', l));
      listings = db.findAll('sellListings');
    }

    if (status) {
      listings = listings.filter(l => (l.verificationStatus || 'PENDING').toUpperCase() === status.toUpperCase());
    }
    if (category) {
      listings = listings.filter(l => (l.category || '').toLowerCase() === category.toLowerCase());
    }

    return res.json(listings);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve marketplace listings.' });
  }
});

// PATCH /api/admin/marketplace/listings/:id/verify (Government Admin certifies or rejects farmer listing)
router.patch('/marketplace/listings/:id/verify', authenticate, requireRole('government_admin', 'ADMIN', 'admin'), (req, res) => {
  try {
    const { status, remarks = '', rejectionReason = '' } = req.body; // 'VERIFIED' or 'REJECTED'
    const normalized = (status || '').toUpperCase();

    if (!['VERIFIED', 'REJECTED', 'PENDING'].includes(normalized)) {
      return res.status(400).json({ error: 'Status must be VERIFIED, REJECTED, or PENDING.' });
    }

    const listing = db.findById('sellListings', req.params.id);
    if (!listing) {
      return res.status(404).json({ error: 'Marketplace listing not found.' });
    }

    const updates = {
      verificationStatus: normalized,
      isGovVerified: normalized === 'VERIFIED',
      verifiedBy: req.user.id || req.user._id,
      verifiedByName: req.user.name || 'Government Livestock Inspector',
      verifiedAt: new Date().toISOString(),
      remarks: remarks || (normalized === 'VERIFIED' ? 'Approved for state inter-district livestock trade.' : ''),
      rejectionReason: normalized === 'REJECTED' ? (rejectionReason || 'Animal health or tag requirements not met') : ''
    };

    const updated = db.updateById('sellListings', req.params.id, updates);

    const io = req.app.get('io');
    if (io) {
      io.emit('marketplace_listing_verified', { listingId: updated.id, status: normalized });
      io.emit('kpi_update', { type: 'MARKETPLACE_STATUS_UPDATED', listingId: updated.id });
    }

    return res.json({
      success: true,
      message: `Listing ${req.params.id} has been ${normalized === 'VERIFIED' ? 'certified & approved' : 'rejected'}.`,
      listing: updated
    });
  } catch (err) {
    console.error('Marketplace listing verify error:', err);
    return res.status(500).json({ error: 'Failed to update listing verification status.' });
  }
});

module.exports = router;

