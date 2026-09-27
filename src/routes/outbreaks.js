const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const outbreakRiskEngine = require('../services/outbreak-risk.service');
const notificationService = require('../services/notification.service');

// Seed default outbreak dataset if empty
function ensureOutbreakSeed() {
  const current = db.findAll('outbreaks');
  if (current && current.length > 0) return current;

  const initialOutbreaks = [
    {
      id: 'outbreak-01',
      outbreakId: 'OBK-2026-849102',
      disease: 'Foot and Mouth Disease (FMD)',
      marathiName: 'लाळ खुरकत रोग (FMD)',
      isPossibleOutbreak: false,
      outbreakType: 'CONFIRMED',
      severity: 'Critical',
      riskCategory: 'CRITICAL',
      riskLevel: 'High Risk',
      district: 'Pune',
      village: 'Khed, Pune',
      clusterRadiusKm: 25,
      casesCount: 18,
      caseCount: 18,
      speciesAffected: ['Cattle', 'Buffalo'],
      symptoms: [
        'High fever (104-106°F)',
        'Excessive stringy salivation & smacking of lips',
        'Vesicles & blisters on tongue and dental pad',
        'Erosions in interdigital cleft leading to acute lameness'
      ],
      transmission: 'Aerosol inhalation, direct contact with contaminated feed/water/vehicles',
      epicenter: { lat: 18.8288, lng: 74.3789 },
      location: { type: 'Point', coordinates: [74.3789, 18.8288] },
      aiPrediction: {
        score: 94,
        confidence: '96%',
        riskFactors: ['3 contiguous herds showing vesicular lesions', 'High cross-taluka cattle transit']
      },
      status: 'Active Containment Zone',
      statusWording: 'Confirmed field case cluster with active containment',
      recommendation: 'Immediate 25km quarantine perimeter and emergency ring vaccination protocol activated.',
      containmentMeasures: [
        'Immediate 25km quarantine perimeter established',
        'Emergency ring vaccination protocol activated within 5km zone',
        'Complete stoppage of animal transport and weekly markets'
      ],
      reportedAgo: '2 hrs ago',
      reportedDate: '26 Sep 2026',
      createdAt: new Date().toISOString()
    },
    {
      id: 'ai-outbreak-02',
      outbreakId: 'OBK-2026-712390',
      disease: 'Lumpy Skin Disease (LSD)',
      marathiName: 'लम्पी स्किन डिसीज (LSD)',
      isPossibleOutbreak: true, // AI PREDICTED OUTBREAK
      outbreakType: 'AI_PREDICTED',
      severity: 'High',
      riskCategory: 'HIGH',
      riskLevel: 'High AI Risk',
      district: 'Satara',
      village: 'Karad, Satara',
      clusterRadiusKm: 18,
      casesCount: 6,
      caseCount: 6,
      speciesAffected: ['Cattle', 'Buffalo'],
      symptoms: [
        'Firm circumscribed skin nodules (2-5cm)',
        'Enlarged prescapular and precrural lymph nodes',
        'Edema in brisket and legs',
        'Sudden drop in milk yield'
      ],
      transmission: 'Mechanical transmission by biting insects (Stomoxys, Aedes mosquitoes, ticks)',
      epicenter: { lat: 17.6805, lng: 74.0183 },
      location: { type: 'Point', coordinates: [74.0183, 17.6805] },
      aiPrediction: {
        score: 86,
        confidence: '89%',
        riskFactors: ['Monsoon humidity > 78% accelerating vector surge', 'Elevated fever clusters reported by dairy farmers']
      },
      status: 'AI Probable Outbreak Warning',
      statusWording: 'AI Predictive Early Warning based on vector density and clinical signals',
      recommendation: 'Prophylactic Goat Pox vaccine ring booster and vector abatement recommended.',
      containmentMeasures: [
        'Prophylactic Goat Pox vaccine ring booster recommended',
        'Intensive village-wide acaricide spraying within 18km radius',
        'Mosquito netting and vector abatement around cattle sheds'
      ],
      reportedAgo: 'AI Detected Today',
      reportedDate: 'Today',
      createdAt: new Date().toISOString()
    },
    {
      id: 'outbreak-03',
      outbreakId: 'OBK-2026-620481',
      disease: 'Anthrax Surveillance Cluster',
      marathiName: 'काळपुळी / फऱ्या रोग',
      isPossibleOutbreak: false,
      outbreakType: 'CONFIRMED',
      severity: 'Critical',
      riskCategory: 'CRITICAL',
      riskLevel: 'High Risk',
      district: 'Nashik',
      village: 'Sinnar, Nashik',
      clusterRadiusKm: 20,
      casesCount: 4,
      caseCount: 4,
      speciesAffected: ['Cattle', 'Sheep', 'Goat'],
      symptoms: [
        'Peracute sudden death without prior signs',
        'Tar-like dark blood oozing from natural orifices',
        'Absence of rigor mortis',
        'Marked abdominal distension'
      ],
      transmission: 'Ingestion of Bacillus anthracis spores from soil, alkaline dry pastures',
      epicenter: { lat: 19.9975, lng: 73.7898 },
      location: { type: 'Point', coordinates: [73.7898, 19.9975] },
      aiPrediction: {
        score: 97,
        confidence: '98%',
        riskFactors: ['Soil spore reactivation post unseasonal rain', 'Positive ear-clip smear on microscope']
      },
      status: 'High Alert Containment',
      statusWording: 'Critical zoonotic spore alert with strict quarantine',
      recommendation: 'Deep burial with unslaked lime, no necropsy, and immediate Sterne spore vaccination.',
      containmentMeasures: [
        'Strict prohibition of carcass opening/necropsy',
        'Deep burial (6ft deep) covered with quicklime',
        'Sterne-strain spore vaccination in all surrounding herds'
      ],
      reportedAgo: '4 hrs ago',
      reportedDate: '26 Sep 2026',
      createdAt: new Date().toISOString()
    },
    {
      id: 'ai-outbreak-04',
      outbreakId: 'OBK-2026-553198',
      disease: 'Bovine Anaplasmosis / Tick Fever',
      marathiName: 'गोचीड ताप (Anaplasmosis)',
      isPossibleOutbreak: true, // AI PREDICTED OUTBREAK
      outbreakType: 'AI_PREDICTED',
      severity: 'Medium',
      riskCategory: 'MEDIUM',
      riskLevel: 'Moderate AI Risk',
      district: 'Solapur',
      village: 'Pandharpur, Solapur',
      clusterRadiusKm: 12,
      casesCount: 7,
      caseCount: 7,
      speciesAffected: ['Cattle', 'Buffalo'],
      symptoms: [
        'Progressive severe anemia with pale mucous membranes',
        'Icterus / Jaundice',
        'Rapid laboured breathing',
        'Persistent high fever (103-105°F)'
      ],
      transmission: 'Biological transmission by Rhipicephalus microplus ticks and dirty needles',
      epicenter: { lat: 17.6599, lng: 75.9064 },
      location: { type: 'Point', coordinates: [75.9064, 17.6599] },
      aiPrediction: {
        score: 75,
        confidence: '82%',
        riskFactors: ['Post-monsoon micro-climate ideal for ixodid tick propagation', 'Reported acaricide resistance']
      },
      status: 'AI Probable Outbreak Warning',
      statusWording: 'Micro-climate tick index elevated above transmission threshold',
      recommendation: 'Synthetic pyrethroid dip baths and prophylactic Oxytetracycline screening.',
      containmentMeasures: [
        'Organophosphate/synthetic pyrethroid dip baths',
        'Oxytetracycline prophylactic chemoprophylaxis for high-risk herds'
      ],
      reportedAgo: 'AI Evaluated Yesterday',
      reportedDate: 'Yesterday',
      createdAt: new Date().toISOString()
    },
    {
      id: 'ai-outbreak-05',
      outbreakId: 'OBK-2026-441029',
      disease: 'Peste des Petits Ruminants (PPR)',
      marathiName: 'शेळ्या-मेंढ्यांची देवी / पीपीआर',
      isPossibleOutbreak: true, // AI PREDICTED OUTBREAK
      outbreakType: 'AI_PREDICTED',
      severity: 'High',
      riskCategory: 'HIGH',
      riskLevel: 'High AI Risk',
      district: 'Ahmednagar',
      village: 'Sangamner, Ahmednagar',
      clusterRadiusKm: 15,
      casesCount: 11,
      caseCount: 11,
      speciesAffected: ['Goat', 'Sheep'],
      symptoms: [
        'High fever followed by necrotic stomatitis',
        'Severe foul-smelling diarrhea and dehydration',
        'Mucopurulent nasal and ocular discharge',
        'Cough and severe bronchopneumonia'
      ],
      transmission: 'Direct contact between infected and susceptible animals, inhalation of aerosol droplets',
      epicenter: { lat: 19.5772, lng: 74.2078 },
      location: { type: 'Point', coordinates: [74.2078, 19.5772] },
      aiPrediction: {
        score: 89,
        confidence: '92%',
        riskFactors: ['Inter-state live goat migratory flock mixing', 'Unvaccinated flock density index > 65%']
      },
      status: 'AI Probable Outbreak Warning',
      statusWording: 'Elevated mortality in small ruminants detected by Pashu AI Sentinel',
      recommendation: 'Live attenuated homologous PPR Sungri 96 strain vaccination ring.',
      containmentMeasures: [
        'Live attenuated homologous PPR Sungri 96 strain vaccination ring',
        'Isolation of symptomatic small ruminants in biosecure shelters',
        'Disinfection with 2% sodium hydroxide solution'
      ],
      reportedAgo: 'AI Detected Today',
      reportedDate: 'Today',
      createdAt: new Date().toISOString()
    }
  ];

  initialOutbreaks.forEach(o => db.create('outbreaks', o));
  return db.findAll('outbreaks');
}

// GET /api/outbreaks (GIS Outbreak Dashboard & Alert Feed)
// Strict Privacy: Farmers only see confirmed public outbreaks; Vets and Gov Admin see all including AI predictions and Doctor Field Alerts.
router.get('/', authenticate, (req, res) => {
  try {
    const { district, severity } = req.query;
    let list = ensureOutbreakSeed();

    // If farmer role, filter out unconfirmed/pending doctor alerts and internal AI risk assessments
    const userRole = (req.user && req.user.role ? req.user.role.toLowerCase() : '');
    if (userRole === 'farmer') {
      list = list.filter(o => !o.isPossibleOutbreak && o.status !== 'VET_FIELD_ALERT');
    }

    if (district) list = list.filter(o => (o.district || '').toLowerCase() === district.toLowerCase());
    if (severity) list = list.filter(o => (o.severity || o.riskCategory || '').toLowerCase() === severity.toLowerCase());
    return res.json(list);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve outbreaks.' });
  }
});

// GET /api/outbreaks/surveillance-layers (3 Interactive GIS Layers for Admin & Vet)
// 1. OBSERVED_CASES
// 2. ENVIRONMENTAL_RISK
// 3. COMBINED_RISK
router.get('/surveillance-layers', authenticate, async (req, res) => {
  try {
    ensureOutbreakSeed();
    const layers = await outbreakRiskEngine.getSurveillanceMapLayers();
    return res.json(layers);
  } catch (err) {
    console.error('Surveillance layers error:', err);
    return res.status(500).json({ error: 'Failed to generate surveillance map layers.' });
  }
});

// POST /api/outbreaks/evaluate (Run automated outbreak risk engine)
router.post('/evaluate', authenticate, requireRole('government_admin', 'ADMIN', 'admin'), async (req, res) => {
  try {
    ensureOutbreakSeed();
    const results = await outbreakRiskEngine.evaluateAllDistricts();
    return res.json({
      success: true,
      message: 'Automated bi-modal outbreak risk evaluation completed.',
      outbreaks: results
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to evaluate outbreak risks.' });
  }
});

// GET /api/outbreaks/clusters (Dynamic GIS cluster scan from reported cases)
router.get('/clusters', authenticate, (req, res) => {
  try {
    const list = ensureOutbreakSeed();
    return res.json(list);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to compute GIS clusters.' });
  }
});

// POST /api/outbreaks (Doctor or Govt Admin reports an outbreak / possible outbreak alert)
// Strictly shared between Veterinarian and Government Dashboard!
router.post('/', authenticate, requireRole('vet', 'VETERINARIAN', 'veterinarian', 'government_admin', 'ADMIN', 'admin'), (req, res) => {
  try {
    const {
      disease,
      diseaseCategory,
      marathiName,
      severity,
      clusterRadiusKm,
      epicenter,
      location,
      district,
      state,
      casesCount,
      caseCount,
      speciesAffected,
      symptoms,
      reason,
      evidence,
      description,
      containmentMeasures,
      isPossibleOutbreak,
      outbreakType,
      aiConfidence
    } = req.body;

    const resolvedDisease = disease || diseaseCategory;
    if (!resolvedDisease) {
      return res.status(400).json({ error: 'Disease name is required.' });
    }

    const isGovAdmin = req.user.role === 'government_admin' || req.user.role === 'ADMIN' || req.user.role === 'admin';
    const isDoctor = !isGovAdmin;

    const possible = isPossibleOutbreak === true || outbreakType === 'AI_PREDICTED' || outbreakType === 'SUSPECTED';
    const count = Number(casesCount || caseCount) || 1;
    const rad = Number(clusterRadiusKm) || 15;

    const newOutbreak = {
      id: `outbreak-${uuidv4().substring(0, 8)}`,
      outbreakId: `OBK-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`,
      disease: resolvedDisease,
      diseaseCategory: resolvedDisease,
      marathiName: marathiName || '',
      isPossibleOutbreak: possible,
      outbreakType: outbreakType || (possible ? 'SUSPECTED' : 'CONFIRMED'),
      severity: severity || 'High',
      riskCategory: (severity || 'HIGH').toUpperCase(),
      riskLevel: severity === 'Critical' ? 'High Risk' : (severity === 'High' ? 'Medium Risk' : 'Low Risk'),
      clusterRadiusKm: rad,
      epicenter: epicenter || location || { lat: 18.5204, lng: 73.8567 },
      location: {
        type: 'Point',
        coordinates: epicenter && epicenter.lng && epicenter.lat ? [epicenter.lng, epicenter.lat] : [73.8567, 18.5204]
      },
      district: district || req.user.district || 'Pune',
      state: state || req.user.state || 'Maharashtra',
      village: req.body.village || `${district || 'Pune'} Rural Block`,
      caseCount: count,
      casesCount: count,
      speciesAffected: Array.isArray(speciesAffected) ? speciesAffected : ['Cattle', 'Buffalo'],
      symptoms: Array.isArray(symptoms) ? symptoms : [
        'Elevated rectal temperature',
        'Clinical signs consistent with infectious transmission'
      ],
      transmission: req.body.transmission || 'Direct animal contact and vector exposure',
      aiPrediction: possible ? {
        score: Number(req.body.aiScore) || 82,
        confidence: aiConfidence || '85%',
        riskFactors: ['Doctor field observation alert', 'Elevated regional cluster transmission index']
      } : undefined,
      reason: reason || description || 'Field clinical evaluation by attending veterinarian.',
      evidence: evidence || 'Direct clinical observation and field symptoms.',
      description: description || reason || 'Doctor outbreak alert submitted to Government Surveillance Cell.',
      status: isDoctor ? 'VET_FIELD_ALERT' : 'Active Containment Zone',
      statusWording: isDoctor ? 'Doctor Field Alert submitted to Government Surveillance Cell' : 'Active Containment Zone',
      recommendation: req.body.recommendation || `Enforce ${rad}km containment perimeter and report further herd symptoms.`,
      containmentMeasures: containmentMeasures || [
        `Immediate ${rad}km perimeter quarantine established`,
        'Automated alert sent to Maharashtra State Disease Surveillance Cell'
      ],
      isDoctorAlert: isDoctor,
      reportedByRole: req.user.role || 'VETERINARIAN',
      reportedByVetId: req.user.id || req.user._id,
      reportedByVetName: req.user.name || 'Veterinary Medical Officer',
      reportedAgo: 'Just now',
      reportedDate: 'Today',
      createdAt: new Date().toISOString()
    };

    db.create('outbreaks', newOutbreak);

    // Push notification alert to Govt disaster cell
    notificationService.notifyOutbreakAlert(newOutbreak.district, resolvedDisease, newOutbreak.severity);

    return res.status(201).json(newOutbreak);
  } catch (err) {
    console.error('Error reporting outbreak:', err);
    return res.status(500).json({ error: 'Failed to record outbreak.' });
  }
});

// POST /api/outbreaks/broadcast (Govt Admin broadcasts warning)
router.post('/broadcast', authenticate, requireRole('government_admin', 'ADMIN', 'admin'), (req, res) => {
  try {
    const { title, message, targetDistrict, targetAudience, urgency } = req.body;
    if (!title || !message) {
      return res.status(400).json({ error: 'Title and message are required.' });
    }

    const broadcast = {
      id: `bcast-${uuidv4().substring(0, 8)}`,
      title,
      message,
      targetDistrict: targetDistrict || 'All',
      targetAudience: targetAudience || 'Farmers & Veterinarians',
      urgency: urgency || 'Immediate',
      sentAt: new Date().toISOString()
    };

    db.create('broadcasts', broadcast);

    notificationService.sendNotification({
      segments: ['Subscribed Users'],
      title,
      message,
      data: { type: 'BROADCAST_ALERT', broadcast }
    });

    return res.status(201).json(broadcast);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to dispatch broadcast.' });
  }
});

// GET /api/outbreaks/broadcasts
router.get('/broadcasts', authenticate, (req, res) => {
  try {
    const broadcasts = db.findAll('broadcasts');
    return res.json(broadcasts);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch broadcasts.' });
  }
});

module.exports = router;
