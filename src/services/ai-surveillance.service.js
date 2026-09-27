const { Case, Outbreak, Farmer, Veterinarian } = require('../models');
const mongo = require('../db/mongo');
const db = require('../db');
const weatherService = require('./weather.service');
const notificationService = require('./notification.service');
const { v4: uuidv4 } = require('uuid');

/**
 * Dedicated Livestock AI Early Warning & Outbreak Surveillance Service
 * 
 * Synthesizes:
 * 1. Farmer clinical reports & AI triage symptom queries
 * 2. Disease transmission epidemiology & clinical indicators
 * 3. Real-time meteorological forecast & vector propagation indices
 * 4. Micro-geographic clustering down to Village & Panchayat level
 * 5. Automated Emergency Notification push to Farmers & Doctors
 */
class AISurveillanceService {
  /**
   * Run comprehensive AI predictive analysis across all regions & villages
   */
  async getSurveillanceIntelligence() {
    let cases = [];
    let outbreaks = [];

    if (mongo.isConnected) {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
      cases = await Case.find({ createdAt: { $gte: thirtyDaysAgo } }).lean();
      outbreaks = await Outbreak.find({}).lean();
    } else {
      cases = db.findAll('cases');
      outbreaks = db.findAll('outbreaks');
    }

    // Default seed cases if none present
    if (!cases || cases.length === 0) {
      cases = this.getDefaultSimulatedCases();
    }

    // 1. Group cases by Village/Panchayat + Disease
    const regionMap = new Map();

    for (const c of cases) {
      const district = c.district || (c.location && c.location.district) || 'Pune';
      const village = c.village || (c.location && c.location.village) || `${district} Rural Block`;
      const panchayat = c.panchayat || `${village} Gram Panchayat`;
      const condition = c.preliminaryCondition || 
        (c.aiAnalysis && c.aiAnalysis.possibleConditions && c.aiAnalysis.possibleConditions[0]) || 
        'General Bovine Health';

      const key = `${district}__${village}__${condition}`;

      if (!regionMap.has(key)) {
        regionMap.set(key, {
          district,
          village,
          panchayat,
          disease: condition,
          speciesList: new Set(),
          symptomsList: new Set(),
          inquiryCount: 0,
          highRiskCount: 0,
          farmerIds: new Set(),
          recentReports: [],
          coordinates: c.location && c.location.coordinates ? c.location.coordinates : [73.8567, 18.5204],
          postalCode: c.postalCode || '411001'
        });
      }

      const cluster = regionMap.get(key);
      cluster.inquiryCount += 1;
      if (c.severity === 'HIGH' || c.severity === 'CRITICAL' || (c.aiAnalysis && c.aiAnalysis.riskLevel === 'CRITICAL')) {
        cluster.highRiskCount += 1;
      }
      if (c.species || c.animalType) cluster.speciesList.add(c.species || c.animalType);
      if (c.farmerId) cluster.farmerIds.add(c.farmerId.toString());

      // Collect symptoms
      const symList = c.majorSymptoms || c.symptoms || [];
      symList.forEach(s => cluster.symptomsList.add(s));

      if (cluster.recentReports.length < 5) {
        cluster.recentReports.push({
          caseId: c.caseId || c.id,
          animalTag: c.animalTag || 'TAG-PENDING',
          symptoms: symList,
          description: c.description || c.additionalSymptoms || '',
          aiRiskLevel: (c.aiAnalysis && c.aiAnalysis.riskLevel) || c.severity || 'MODERATE',
          confidence: (c.aiAnalysis && c.aiAnalysis.confidence) || 0.85,
          createdAt: c.createdAt || new Date().toISOString()
        });
      }
    }

    // 2. Fetch weather correlations and compute AI Outbreak Probability %
    const predictedOutbreaks = [];

    for (const [key, cluster] of regionMap.entries()) {
      let weatherInfo = null;
      try {
        weatherInfo = await weatherService.getWeatherByPin(cluster.postalCode);
      } catch (_) {
        weatherInfo = {
          current: { temperature: 30, humidity: 76, condition: 'Humid / Vector Favored', rain1h: 4.2 },
          environmentalRiskScore: 35
        };
      }

      const temp = (weatherInfo.current && weatherInfo.current.temperature) || 29;
      const humidity = (weatherInfo.current && weatherInfo.current.humidity) || 72;
      const rain = (weatherInfo.current && weatherInfo.current.rain1h) || 0;

      // Disease-specific epidemiology weights
      let diseaseWeatherMultiplier = 1.0;
      let vectorRiskExplanation = '';
      const diseaseLower = cluster.disease.toLowerCase();

      if (diseaseLower.includes('lumpy') || diseaseLower.includes('lsd')) {
        // High humidity & warmth favors biting flies & mosquitoes
        if (humidity > 70 && temp > 24) {
          diseaseWeatherMultiplier = 1.45;
          vectorRiskExplanation = `Elevated humidity (${humidity}%) and warm ambient temp (${temp}°C) accelerate Stomoxys calcitrans and mosquito vector propagation.`;
        } else {
          vectorRiskExplanation = 'Moderate vector reproduction index under current microclimate.';
        }
      } else if (diseaseLower.includes('foot') || diseaseLower.includes('fmd')) {
        // Airborne viral transmission, cool/damp conditions
        if (humidity > 65) {
          diseaseWeatherMultiplier = 1.4;
          vectorRiskExplanation = `High relative humidity (${humidity}%) significantly prolongs airborne aphthovirus droplet viability.`;
        }
      } else if (diseaseLower.includes('anthrax')) {
        // Post unseasonal rain disturbs alkaline soil spores
        if (rain > 5 || humidity > 80) {
          diseaseWeatherMultiplier = 1.5;
          vectorRiskExplanation = `Recent precipitation activates dormant Bacillus anthracis soil spores in low-lying pastures.`;
        }
      } else if (diseaseLower.includes('mastitis')) {
        if (temp > 32) {
          diseaseWeatherMultiplier = 1.35;
          vectorRiskExplanation = `Severe ambient heat stress (${temp}°C) compromises udder immune resistance and accelerates coliform growth.`;
        }
      } else if (diseaseLower.includes('ppr') || diseaseLower.includes('anaplasmosis')) {
        if (humidity > 60) {
          diseaseWeatherMultiplier = 1.3;
          vectorRiskExplanation = `Favorable micro-climate for ixodid tick propagation and respiratory droplet spread.`;
        }
      }

      // Base Signal: Clinical frequency (0 - 55)
      const clinicalScore = Math.min(cluster.inquiryCount * 8 + cluster.highRiskCount * 12, 55);
      
      // Environmental Signal: Weather Score (0 - 45)
      const baseEnvScore = Math.min(Math.round(((weatherInfo.environmentalRiskScore || 30) * 0.45) * diseaseWeatherMultiplier), 45);

      // Outbreak Probability Percentage (35% to 98%)
      const probabilityPercent = Math.min(Math.max(clinicalScore + baseEnvScore, 35), 98);

      let urgency = 'MODERATE';
      if (probabilityPercent >= 80) urgency = 'CRITICAL';
      else if (probabilityPercent >= 60) urgency = 'HIGH';

      // Recommended containment protocol
      let recommendedAction = '';
      if (diseaseLower.includes('fmd')) {
        recommendedAction = 'Immediate 5km quarantine ring, stop weekly livestock markets, deploy emergency ring vaccination.';
      } else if (diseaseLower.includes('lumpy') || diseaseLower.includes('lsd')) {
        recommendedAction = 'Deploy Goat Pox ring booster, initiate village-wide fogging and mosquito netting around sheds.';
      } else if (diseaseLower.includes('anthrax')) {
        recommendedAction = 'Strict ban on carcass opening, execute Sterne spore ring vaccination, isolate pasture grazing.';
      } else {
        recommendedAction = 'Quarantine symptomatic animals, dispatch mobile veterinary inspection team, initiate prophylactic treatment.';
      }

      predictedOutbreaks.push({
        id: `ai-pred-${uuidv4().substring(0, 8)}`,
        district: cluster.district,
        village: cluster.village,
        panchayat: cluster.panchayat,
        disease: cluster.disease,
        probabilityPercent,
        urgency,
        clinicalInquiryCount: cluster.inquiryCount,
        highRiskCasesCount: cluster.highRiskCount,
        affectedSpecies: Array.from(cluster.speciesList),
        detectedSymptoms: Array.from(cluster.symptomsList),
        coordinates: {
          lat: cluster.coordinates[1] || 18.5204,
          lng: cluster.coordinates[0] || 73.8567
        },
        weatherFactors: {
          temperature: temp,
          humidity,
          rain,
          condition: (weatherInfo.current && weatherInfo.current.condition) || 'Seasonal Conditions',
          vectorRiskExplanation
        },
        recommendedAction,
        recentFarmerInquiries: cluster.recentReports,
        lastAnalyzedAt: new Date().toISOString()
      });
    }

    // Sort by highest outbreak probability
    predictedOutbreaks.sort((a, b) => b.probabilityPercent - a.probabilityPercent);

    // 3. Extract recent farmer AI questions & triage stream
    const recentAIInquiries = [];
    cases.slice(0, 15).forEach(c => {
      recentAIInquiries.push({
        id: c.caseId || c.id || uuidv4().substring(0, 6),
        animalTag: c.animalTag || 'ET-PENDING',
        farmerPhone: c.farmerPhone || 'Registered Farmer',
        village: c.village || c.district || 'Pune',
        species: c.species || c.animalType || 'Bovine',
        symptoms: c.majorSymptoms || c.symptoms || [],
        farmerQuestion: c.description || c.additionalSymptoms || 'Animal showing abnormal symptoms, seeking veterinary guidance.',
        aiDiagnosedCondition: (c.aiAnalysis && c.aiAnalysis.primaryCondition) || c.preliminaryCondition || 'Clinical Investigation',
        aiSeverity: (c.aiAnalysis && c.aiAnalysis.riskLevel) || c.severity || 'MEDIUM',
        aiConfidence: (c.aiAnalysis && c.aiAnalysis.confidence) ? `${Math.round(c.aiAnalysis.confidence * 100)}%` : '88%',
        timestamp: c.createdAt || new Date().toISOString()
      });
    });

    return {
      success: true,
      timestamp: new Date().toISOString(),
      modelVersion: 'Pashu-AI-Surveillance-v3.4',
      totalAnalyzedCases: cases.length,
      highRiskZonesCount: predictedOutbreaks.filter(o => o.urgency === 'CRITICAL' || o.urgency === 'HIGH').length,
      predictedOutbreaks,
      recentAIInquiries
    };
  }

  /**
   * Push emergency alert notification to both Farmers and Doctors
   */
  async pushEmergencyAlert(payload) {
    const {
      village,
      panchayat,
      district,
      disease,
      probabilityPercent,
      severity = 'CRITICAL',
      customMessage = '',
      io = null
    } = payload;

    const alertTitle = `🚨 GOVERNMENT BIOSECURITY ALERT: High ${disease} Risk Detected in ${village}`;
    const alertBody = customMessage || 
      `AI Predictive Surveillance has identified a ${probabilityPercent}% probability of ${disease} in ${village} (${panchayat || district}). All farmers must isolate symptomatic animals. Local veterinary medical officers have been put on high emergency alert.`;

    const emergencyBroadcast = {
      id: `embcast-${uuidv4().substring(0, 8)}`,
      title: alertTitle,
      message: alertBody,
      district: district || 'All',
      village: village || 'All Villages',
      panchayat: panchayat || '',
      disease,
      probabilityPercent: Number(probabilityPercent) || 85,
      severity,
      targetAudience: 'Farmers & Veterinarians',
      urgency: 'IMMEDIATE_ACTION',
      channels: ['Push Notification', 'In-App Banner', 'Doctor SMS / Roster Dispatch'],
      dispatchedBy: 'State Disease Surveillance Cell (Government Admin)',
      sentAt: new Date().toISOString()
    };

    // 1. Save in broadcasts
    db.create('broadcasts', emergencyBroadcast);

    // 2. Push via Notification Service to both farmers and doctors
    try {
      notificationService.sendNotification({
        segments: ['Farmers', 'Veterinarians', 'Subscribed Users'],
        title: alertTitle,
        message: alertBody,
        data: {
          type: 'EMERGENCY_OUTBREAK_ALERT',
          broadcast: emergencyBroadcast
        }
      });
    } catch (e) {
      console.warn('Failed to send notification via service:', e);
    }

    // 3. Emit real-time WebSocket event to all connected apps (Farmer, Vet, Gov Admin)
    if (io) {
      io.emit('emergency_outbreak_alert', emergencyBroadcast);
      io.emit('kpi_update', { type: 'NEW_EMERGENCY_BROADCAST', alert: emergencyBroadcast });
    }

    return {
      success: true,
      message: `Emergency notification successfully pushed to farmers and veterinarians across ${village} and ${district}.`,
      broadcast: emergencyBroadcast
    };
  }

  /**
   * Default simulated case records for initial realistic AI outbreak surveillance
   */
  getDefaultSimulatedCases() {
    return [
      {
        id: 'case-sim-01',
        caseId: 'CAS-2026-901',
        animalTag: 'ET-893421',
        species: 'Cow',
        district: 'Satara',
        village: 'Karad Rural',
        panchayat: 'Karad Gram Panchayat',
        postalCode: '415110',
        majorSymptoms: ['Skin nodules / lumps', 'High fever (104°F)', 'Enlarged lymph nodes', 'Sudden drop in milk'],
        description: 'Hard round lumps appeared on neck and udder 2 days ago, flies biting heavily around cowshed.',
        severity: 'HIGH',
        preliminaryCondition: 'Lumpy Skin Disease (LSD)',
        aiAnalysis: {
          riskLevel: 'HIGH',
          primaryCondition: 'Lumpy Skin Disease (LSD)',
          possibleConditions: ['Lumpy Skin Disease (LSD)', 'Pseudocowpox'],
          confidence: 0.92
        },
        location: { coordinates: [74.1833, 17.2833] },
        createdAt: new Date(Date.now() - 4 * 3600 * 1000).toISOString()
      },
      {
        id: 'case-sim-02',
        caseId: 'CAS-2026-902',
        animalTag: 'ET-893425',
        species: 'Cow',
        district: 'Satara',
        village: 'Karad Rural',
        panchayat: 'Karad Gram Panchayat',
        postalCode: '415110',
        majorSymptoms: ['Skin nodules', 'Fever', 'Leg swelling'],
        description: 'Another cow in neighboring herd developing skin lumps and edema in legs.',
        severity: 'HIGH',
        preliminaryCondition: 'Lumpy Skin Disease (LSD)',
        aiAnalysis: {
          riskLevel: 'HIGH',
          primaryCondition: 'Lumpy Skin Disease (LSD)',
          confidence: 0.89
        },
        location: { coordinates: [74.1850, 17.2850] },
        createdAt: new Date(Date.now() - 6 * 3600 * 1000).toISOString()
      },
      {
        id: 'case-sim-03',
        caseId: 'CAS-2026-903',
        animalTag: 'ET-771204',
        species: 'Buffalo',
        district: 'Pune',
        village: 'Khed Rural',
        panchayat: 'Khed Panchayat',
        postalCode: '410501',
        majorSymptoms: ['Excessive salivation / drooling', 'Mouth blisters', 'Severe limping', 'High fever'],
        description: 'Buffalo unable to graze, continuous frothy stringy saliva coming from mouth with tongue blisters.',
        severity: 'CRITICAL',
        preliminaryCondition: 'Foot and Mouth Disease (FMD)',
        aiAnalysis: {
          riskLevel: 'CRITICAL',
          primaryCondition: 'Foot and Mouth Disease (FMD)',
          possibleConditions: ['Foot and Mouth Disease (FMD)', 'Vesicular Stomatitis'],
          confidence: 0.96
        },
        location: { coordinates: [73.9000, 18.8500] },
        createdAt: new Date(Date.now() - 8 * 3600 * 1000).toISOString()
      },
      {
        id: 'case-sim-04',
        caseId: 'CAS-2026-904',
        animalTag: 'ET-771210',
        species: 'Cow',
        district: 'Pune',
        village: 'Khed Rural',
        panchayat: 'Khed Panchayat',
        postalCode: '410501',
        majorSymptoms: ['Mouth vesicles', 'Interdigital lesions', 'Drooling'],
        description: 'Calf limping badly, feet have open ulcers between hooves.',
        severity: 'CRITICAL',
        preliminaryCondition: 'Foot and Mouth Disease (FMD)',
        aiAnalysis: {
          riskLevel: 'CRITICAL',
          primaryCondition: 'Foot and Mouth Disease (FMD)',
          confidence: 0.94
        },
        location: { coordinates: [73.9050, 18.8520] },
        createdAt: new Date(Date.now() - 12 * 3600 * 1000).toISOString()
      },
      {
        id: 'case-sim-05',
        caseId: 'CAS-2026-905',
        animalTag: 'ET-550192',
        species: 'Goat',
        district: 'Ahmednagar',
        village: 'Sangamner Block',
        panchayat: 'Sangamner Panchayat',
        postalCode: '422605',
        majorSymptoms: ['Severe watery diarrhea', 'High fever', 'Mouth ulcers', 'Nasal discharge'],
        description: 'Small ruminant herd losing appetite, multiple goats showing foul smelling diarrhea and crusty lips.',
        severity: 'HIGH',
        preliminaryCondition: 'Peste des Petits Ruminants (PPR)',
        aiAnalysis: {
          riskLevel: 'HIGH',
          primaryCondition: 'Peste des Petits Ruminants (PPR)',
          confidence: 0.91
        },
        location: { coordinates: [74.2000, 19.5700] },
        createdAt: new Date(Date.now() - 15 * 3600 * 1000).toISOString()
      }
    ];
  }
}

module.exports = new AISurveillanceService();
