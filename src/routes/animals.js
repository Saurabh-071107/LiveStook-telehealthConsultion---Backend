const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { Animal, AnimalImage } = require('../models');
const { isConnected } = require('../db/mongo');
const { authenticate, requireRole } = require('../middleware/auth');
const medicalReportService = require('../services/medical-report.service');

// Helper to generate human-readable Animal ID: ANM-YYYY-NNNNNN
function generateAnimalId() {
  const year = new Date().getFullYear();
  const seq = Math.floor(100000 + Math.random() * 900000);
  return `ANM-${year}-${seq}`;
}

// GET /api/animals (Filtered by owner if farmer, enriched with Doctor & AI treatment status)
router.get('/', authenticate, async (req, res) => {
  try {
    let animals = [];

    if (isConnected) {
      const query = req.user.role === 'FARMER' || req.user.role === 'farmer' 
        ? { ownerId: req.user._id || req.user.id } 
        : {};
      animals = await Animal.find(query).lean();
    } else {
      if (req.user.role === 'farmer' || req.user.role === 'FARMER') {
        animals = db.findAll('animals', a => a.ownerId === req.user.id);
      } else {
        animals = db.findAll('animals');
      }
    }

    const allCases = isConnected ? [] : db.findAll('cases');

    const enrichedAnimals = animals.map(animal => {
      const animalTag = animal.earTagId || animal.tagNumber;
      const animalId = animal.animalId || animal.id;
      const activeCase = allCases.find(c => (c.animalId === animalId || c.animalTag === animalTag) && c.status !== 'resolved' && c.status !== 'CLOSED');

      let dynamicStatus = animal.healthStatus || 'Healthy';
      let hasOngoingTreatment = false;
      let treatmentInfo = null;

      if (activeCase) {
        hasOngoingTreatment = true;
        dynamicStatus = 'Ongoing Treatment';
        treatmentInfo = {
          caseId: activeCase.caseId || activeCase.id,
          suspectedDisease: activeCase.aiPredictedDisease || 'Under Veterinary Treatment',
          vetNotes: activeCase.vetNotes || 'Clinical examination in progress',
          prescriptions: activeCase.prescriptions || [],
          status: activeCase.status,
          reportedAt: activeCase.createdAt
        };
      } else if (
        dynamicStatus.toLowerCase().includes('sick') ||
        dynamicStatus.toLowerCase().includes('treatment') ||
        dynamicStatus.toLowerCase().includes('critical')
      ) {
        hasOngoingTreatment = true;
        dynamicStatus = 'Ongoing Treatment';
      }

      return {
        ...animal,
        id: animal.animalId || animal.id,
        tagNumber: animal.earTagId || animal.tagNumber,
        earTagId: animal.earTagId || animal.tagNumber,
        species: animal.type || animal.species,
        ageYears: animal.ageYears || 3,
        healthStatus: dynamicStatus,
        hasOngoingTreatment,
        treatmentInfo
      };
    });

    return res.json(enrichedAnimals);
  } catch (err) {
    console.error('Error fetching animals:', err);
    return res.status(500).json({ error: 'Failed to retrieve animals.' });
  }
});

// GET /api/animals/dashboard-summary
router.get('/dashboard-summary', authenticate, (req, res) => {
  try {
    const farmerId = req.user.id || req.user._id;
    const myAnimals = db.findAll('animals', a => a.ownerId === farmerId);
    const myAppointments = db.findAll('appointments', a => a.farmerId === farmerId);
    const schedules = db.findAll('vaccinationSchedules');

    const district = (req.user.district || 'Pune').toLowerCase();
    const activeSchedules = schedules.filter(s => 
      s.district && s.district.toLowerCase() === district && s.status === 'active'
    );

    return res.json({
      totalAnimals: myAnimals.length,
      vaccinationsDue: activeSchedules.length || 2,
      appointmentsToday: myAppointments.length > 0 ? myAppointments.length : 1,
      weather: {
        temp: '28°C',
        condition: 'Humid/Clear',
        city: req.user.district || 'Pune',
        state: req.user.state || 'Maharashtra'
      }
    });
  } catch (err) {
    console.error('Summary error:', err);
    return res.status(500).json({ error: 'Failed to fetch dashboard summary.' });
  }
});

// GET /api/animals/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    let animal;
    if (isConnected) {
      animal = await Animal.findOne({
        $or: [{ animalId: req.params.id }, { earTagId: req.params.id }]
      }).lean();
    } else {
      animal = db.findById('animals', req.params.id) ||
               db.findAll('animals', a => a.tagNumber === req.params.id || a.earTagId === req.params.id)[0];
    }

    if (!animal) return res.status(404).json({ error: 'Animal not found.' });

    const response = {
      ...animal,
      id: animal.animalId || animal.id,
      tagNumber: animal.earTagId || animal.tagNumber,
      species: animal.type || animal.species
    };
    return res.json(response);
  } catch (err) {
    return res.status(500).json({ error: 'Error fetching animal.' });
  }
});

// GET /api/animals/:id/medical-history
router.get('/:id/medical-history', authenticate, async (req, res) => {
  try {
    const history = await medicalReportService.getFullMedicalHistory(req.params.id);
    return res.json(history);
  } catch (err) {
    return res.status(404).json({ error: err.message });
  }
});

// GET /api/animals/:id/medical-report (Printable HTML / PDF format)
router.get('/:id/medical-report', authenticate, async (req, res) => {
  try {
    const history = await medicalReportService.getFullMedicalHistory(req.params.id);
    const html = medicalReportService.generateHtmlReport(history);
    res.setHeader('Content-Type', 'text/html');
    return res.send(html);
  } catch (err) {
    return res.status(404).send(`<h1>Report Error</h1><p>${err.message}</p>`);
  }
});

// POST /api/animals (Register new animal with unique Ear Tag validation)
router.post('/', authenticate, requireRole('farmer', 'FARMER', 'government_admin', 'ADMIN'), async (req, res) => {
  try {
    const { name, age, ageYears, tagNumber, earTagNumber, earTagId, species, type, breed, gender, photoUrl } = req.body;

    const resolvedName = name ? name.trim() : '';
    const resolvedTag = (tagNumber || earTagNumber || earTagId || '').trim().toUpperCase();
    const resolvedAge = Number(ageYears || age) || 1;
    const resolvedSpecies = type || species || 'Cow';
    const resolvedBreed = breed ? breed.trim() : (resolvedSpecies.toLowerCase().includes('buffalo') ? 'Murrah' : 'HF Cross');

    if (!resolvedName) {
      return res.status(400).json({ error: 'Animal Name is required.' });
    }

    if (!resolvedTag) {
      return res.status(400).json({ error: 'Ear Tag ID is required.' });
    }

    // REQUIREMENT 8: Ear Tag ID must be unique. Reject duplicates!
    let duplicate = false;
    if (isConnected) {
      const existing = await Animal.findOne({ earTagId: resolvedTag });
      if (existing) duplicate = true;
    } else {
      const existing = db.findAll('animals', a => (a.tagNumber && a.tagNumber.toUpperCase() === resolvedTag) || (a.earTagId && a.earTagId.toUpperCase() === resolvedTag));
      if (existing.length > 0) duplicate = true;
    }

    if (duplicate) {
      return res.status(409).json({
        error: `Ear Tag ID '${resolvedTag}' is already registered in the National Animal Health Network. Duplicate tags are prohibited.`
      });
    }

    // System-generated human-readable Animal ID
    const animalId = generateAnimalId();

    let defaultPhoto = 'assets/images/animal_cow.png';
    if (resolvedSpecies.toLowerCase().includes('buffalo')) defaultPhoto = 'assets/images/animal_buffalo.png';
    else if (resolvedSpecies.toLowerCase().includes('goat')) defaultPhoto = 'assets/images/animal_goat.png';

    const animalDoc = {
      id: animalId,
      animalId,
      earTagId: resolvedTag,
      tagNumber: resolvedTag,
      ownerId: req.user.id || req.user._id,
      name: resolvedName,
      species: resolvedSpecies,
      type: resolvedSpecies,
      breed: resolvedBreed,
      ageYears: resolvedAge,
      age: `${resolvedAge} years`,
      gender: gender || 'Female',
      lactationStage: 'Active',
      dailyMilkYieldLiters: 10.0,
      photoUrl: photoUrl || defaultPhoto,
      vaccinationStatus: 'Up to Date',
      healthStatus: 'HEALTHY',
      location: req.user.location || { lat: 18.5204, lng: 73.8567 },
      district: req.user.district || 'Pune',
      state: req.user.state || 'Maharashtra',
      createdAt: new Date().toISOString()
    };

    if (isConnected) {
      await Animal.create({
        ...animalDoc,
        location: { type: 'Point', coordinates: [req.user.location?.lng || 73.8567, req.user.location?.lat || 18.5204] }
      });
    }

    db.create('animals', animalDoc);
    return res.status(201).json(animalDoc);
  } catch (err) {
    console.error('Error adding animal:', err);
    return res.status(500).json({ error: 'Failed to register animal.' });
  }
});

// POST /api/animals/:id/images (Support 4-side animal images: FRONT, BACK, LEFT, RIGHT)
router.post('/:id/images', authenticate, async (req, res) => {
  try {
    const { viewType, imageUrl } = req.body;
    const allowedViews = ['FRONT', 'BACK', 'LEFT', 'RIGHT'];

    if (!viewType || !allowedViews.includes(viewType.toUpperCase())) {
      return res.status(400).json({
        error: `Invalid viewType. Supported views are: ${allowedViews.join(', ')}`
      });
    }

    if (!imageUrl) {
      return res.status(400).json({ error: 'Image URL is required.' });
    }

    const imageRecord = {
      id: `img-${uuidv4().substring(0, 8)}`,
      animalId: req.params.id,
      imageUrl,
      viewType: viewType.toUpperCase(),
      uploadedAt: new Date().toISOString()
    };

    if (isConnected) {
      await AnimalImage.create(imageRecord);
    }
    db.create('animalImages', imageRecord);

    return res.status(201).json(imageRecord);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to upload animal side image.' });
  }
});

// PATCH /api/animals/:id
router.patch('/:id', authenticate, (req, res) => {
  try {
    const existing = db.findById('animals', req.params.id) ||
                     db.findAll('animals', a => a.tagNumber === req.params.id || a.earTagId === req.params.id)[0];
    if (!existing) {
      return res.status(404).json({ error: 'Animal not found.' });
    }

    const { name, breed, ageYears, weightKg, lactationStage, gender, vaccinationStatus } = req.body;
    const updates = {};
    if (name) updates.name = name.trim();
    if (breed) updates.breed = breed.trim();
    if (ageYears !== undefined) updates.ageYears = Number(ageYears);
    if (weightKg !== undefined) updates.weightKg = Number(weightKg);
    if (lactationStage) updates.lactationStage = lactationStage;
    if (gender) updates.gender = gender;
    if (vaccinationStatus) updates.vaccinationStatus = vaccinationStatus;

    const updated = db.updateById('animals', existing.id, updates);
    return res.json(updated);
  } catch (err) {
    console.error('Error updating animal:', err);
    return res.status(500).json({ error: 'Failed to update animal.' });
  }
});

module.exports = router;
