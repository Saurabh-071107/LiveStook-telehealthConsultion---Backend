const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

// GET /api/animals (Filtered by owner if farmer, enriched with Doctor & AI treatment status)
router.get('/', authenticate, (req, res) => {
  try {
    let animals = [];
    if (req.user.role === 'farmer') {
      animals = db.findAll('animals', a => a.ownerId === req.user.id);
    } else {
      animals = db.findAll('animals');
    }

    const allCases = db.findAll('cases');

    // Requirement 8: Tag will be dynamically changed to "Ongoing Treatment" according to Doctor or AI response
    const enrichedAnimals = animals.map(animal => {
      // Check if animal has an active case diagnosed by AI or Doctor
      const activeCase = allCases.find(c => c.animalId === animal.id && c.status !== 'resolved');

      let dynamicStatus = animal.healthStatus || 'Healthy';
      let hasOngoingTreatment = false;
      let treatmentInfo = null;

      if (activeCase) {
        hasOngoingTreatment = true;
        dynamicStatus = 'Ongoing Treatment';
        treatmentInfo = {
          caseId: activeCase.id,
          suspectedDisease: activeCase.aiPredictedDisease || 'Under Veterinary Treatment',
          vetNotes: activeCase.vetNotes || 'Clinical examination in progress',
          prescriptions: activeCase.prescriptions || [],
          status: activeCase.status,
          reportedAt: activeCase.createdAt
        };
      } else if (
        dynamicStatus.toLowerCase().includes('sick') ||
        dynamicStatus.toLowerCase().includes('treatment') ||
        dynamicStatus.toLowerCase().includes('examination') ||
        dynamicStatus.toLowerCase().includes('critical')
      ) {
        hasOngoingTreatment = true;
        dynamicStatus = 'Ongoing Treatment';
      } else {
        dynamicStatus = 'Healthy';
      }

      return {
        ...animal,
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

// GET /api/animals/dashboard-summary (Stats for Farmer Home Dashboard)
router.get('/dashboard-summary', authenticate, (req, res) => {
  try {
    const farmerId = req.user.id;
    const myAnimals = db.findAll('animals', a => a.ownerId === farmerId);
    const myAppointments = db.findAll('appointments', a => a.farmerId === farmerId);
    const schedules = db.findAll('vaccinationSchedules');

    // Count vaccinations due (schedules active in farmer's district)
    const district = (req.user.district || 'Pune').toLowerCase();
    const activeSchedules = schedules.filter(s => 
      s.district.toLowerCase() === district && s.status === 'active'
    );

    return res.json({
      totalAnimals: myAnimals.length,
      vaccinationsDue: activeSchedules.length || 2,
      appointmentsToday: myAppointments.length > 0 ? myAppointments.length : 1,
      weather: {
        temp: '26°C',
        condition: 'Clear Sky',
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
router.get('/:id', authenticate, (req, res) => {
  try {
    const animal = db.findById('animals', req.params.id);
    if (!animal) return res.status(404).json({ error: 'Animal not found.' });

    // Attach active case details if any
    const activeCase = db.findAll('cases', c => c.animalId === animal.id && c.status !== 'resolved')[0];
    const isOngoing = activeCase != null || animal.healthStatus.toLowerCase().includes('treatment');

    return res.json({
      ...animal,
      healthStatus: isOngoing ? 'Ongoing Treatment' : 'Healthy',
      hasOngoingTreatment: isOngoing,
      activeCase
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error fetching animal.' });
  }
});

// POST /api/animals (Add new animal)
// Requirement 6: Asks Name, Age, and Ear Tag Number
// Requirement 7: System-generated internal animal ID not shown to farmer
router.post('/', authenticate, requireRole('farmer', 'government_admin'), (req, res) => {
  try {
    const { name, age, ageYears, tagNumber, earTagNumber, species, breed, gender, photoUrl } = req.body;

    const resolvedName = name ? name.trim() : '';
    const resolvedTag = (tagNumber || earTagNumber || '').trim().toUpperCase();
    const resolvedAge = Number(ageYears || age) || 1;
    const resolvedSpecies = species || 'Cow';
    const resolvedBreed = breed ? breed.trim() : (resolvedSpecies === 'Buffalo' ? 'Murrah' : (resolvedSpecies === 'Goat' ? 'Boer' : 'HF Cross'));

    if (!resolvedName) {
      return res.status(400).json({ error: 'Animal Name is required.' });
    }

    if (!resolvedTag) {
      return res.status(400).json({ error: 'Ear Tag Number is required.' });
    }

    // Requirement 7: System Reference ID for internal backend / vet reference (hidden from farmer)
    const internalSystemId = `SYS-ANML-${uuidv4().substring(0, 8).toUpperCase()}`;

    // Select default photo asset matching the species
    let defaultPhoto = 'assets/images/animal_cow.png';
    if (resolvedSpecies.toLowerCase().includes('buffalo')) {
      defaultPhoto = 'assets/images/animal_buffalo.png';
    } else if (resolvedSpecies.toLowerCase().includes('goat')) {
      defaultPhoto = 'assets/images/animal_goat.png';
    }

    const newAnimal = {
      id: internalSystemId, // Internal system reference
      tagNumber: resolvedTag, // Ear Tag Number shown to farmer
      ownerId: req.user.id,
      name: resolvedName,
      species: resolvedSpecies,
      breed: resolvedBreed,
      ageYears: resolvedAge,
      gender: gender || 'Female',
      lactationStage: 'Active',
      dailyMilkYieldLiters: 10.0,
      photoUrl: photoUrl || defaultPhoto,
      vaccinationStatus: 'Up to Date',
      healthStatus: 'Healthy',
      location: req.user.location || { lat: 18.5204, lng: 73.8567 },
      createdAt: new Date().toISOString()
    };

    db.create('animals', newAnimal);
    return res.status(201).json(newAnimal);
  } catch (err) {
    console.error('Error adding animal:', err);
    return res.status(500).json({ error: 'Failed to register animal.' });
  }
});

// PATCH /api/animals/:id (Edit animal details)
router.patch('/:id', authenticate, (req, res) => {
  try {
    const existing = db.findById('animals', req.params.id) ||
                     db.findAll('animals', a => a.tagNumber === req.params.id)[0];
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
