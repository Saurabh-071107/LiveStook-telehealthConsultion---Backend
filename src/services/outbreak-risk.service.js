const { Case, Outbreak, Farmer, WeatherData } = require('../models');
const { isConnected } = require('../db/mongo');
const db = require('../db');
const weatherService = require('./weather.service');

/**
 * Outbreak Risk Engine
 * Fuses Signal A (Observed clinical disease activity & spatial/temporal clusters)
 * with Signal B (Environmental vector & bacterial propagation risk from OpenWeather)
 * to output calibrated geographic outbreak warning levels.
 */
class OutbreakRiskEngine {
  /**
   * Run risk analysis across active geographic districts
   */
  async evaluateAllDistricts() {
    let cases = [];
    if (isConnected) {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
      cases = await Case.find({ createdAt: { $gte: thirtyDaysAgo } }).lean();
    } else {
      cases = db.findAll('cases');
    }

    // Group cases by district and disease
    const clusters = {};

    cases.forEach(c => {
      const district = c.district || (c.location && c.location.district) || 'Pune';
      const disease = c.preliminaryCondition || (c.aiAnalysis && c.aiAnalysis.possibleConditions && c.aiAnalysis.possibleConditions[0]) || 'General Bovine Health';
      const key = `${district}_${disease}`;

      if (!clusters[key]) {
        clusters[key] = {
          district,
          state: c.state || 'Maharashtra',
          diseaseCategory: disease,
          postalCodes: new Set(),
          caseCount: 0,
          highRiskCount: 0,
          confirmedDiagnoses: 0,
          sampleCoords: c.location && c.location.coordinates ? c.location.coordinates : [73.8567, 18.5204]
        };
      }

      clusters[key].caseCount += 1;
      if (c.postalCode) clusters[key].postalCodes.add(c.postalCode);
      if (c.severity === 'HIGH' || c.severity === 'CRITICAL' || c.status === 'CONSULTATION_ACTIVE') {
        clusters[key].highRiskCount += 1;
      }
      if (c.status === 'DIAGNOSIS_COMPLETED' || c.status === 'TREATMENT_CREATED') {
        clusters[key].confirmedDiagnoses += 1;
      }
    });

    const evaluatedOutbreaks = [];

    // Evaluate risk for each cluster
    for (const key of Object.keys(clusters)) {
      const cluster = clusters[key];
      const postalCodeList = Array.from(cluster.postalCodes);
      const primaryPin = postalCodeList[0] || '411001';

      // 1. SIGNAL A: Observed Disease Activity Score (0 - 50)
      // Based on frequency, severe cases, and confirmed diagnoses
      let signalAScore = Math.min(cluster.caseCount * 4 + cluster.highRiskCount * 6 + cluster.confirmedDiagnoses * 5, 50);

      // 2. SIGNAL B: Environmental Risk Score (0 - 50)
      // Fetched from Weather Service (temperature, humidity, precipitation)
      const weatherInfo = await weatherService.getWeatherByPin(primaryPin);
      const rawEnv = weatherInfo.environmentalRiskScore || 20;
      let signalBScore = Math.round(rawEnv * 0.5); // scale 0-100 to 0-50

      // 3. COMBINED OUTBREAK RISK (0 - 100)
      const combinedScore = Math.min(signalAScore + signalBScore, 100);

      let riskCategory = 'LOW';
      let statusWording = 'Normal surveillance parameters';
      let recommendation = 'Standard preventive biosecurity practices recommended.';

      if (combinedScore >= 75) {
        riskCategory = 'CRITICAL';
        statusWording = 'Potential outbreak risk with high environmental transmission probability';
        recommendation = 'Veterinary attention recommended immediately. Enforce strict quarantine and ring vaccination.';
      } else if (combinedScore >= 50) {
        riskCategory = 'HIGH';
        statusWording = 'Observed case cluster with elevated environmental risk factors';
        recommendation = 'Enhanced biosecurity, clinical screening, and vector control recommended.';
      } else if (combinedScore >= 30) {
        riskCategory = 'MODERATE';
        statusWording = 'Environmental conditions associated with elevated risk';
        recommendation = 'Monitor herd hydration, body temperature, and report early fever to dispensary.';
      }

      const outbreakDoc = {
        outbreakId: `OBK-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`,
        diseaseCategory: cluster.diseaseCategory,
        region: `${cluster.district}, ${cluster.state}`,
        district: cluster.district,
        state: cluster.state,
        location: {
          type: 'Point',
          coordinates: cluster.sampleCoords
        },
        caseCount: cluster.caseCount,
        timeWindowDays: 30,
        observedCaseScore: signalAScore,
        environmentalScore: signalBScore,
        combinedRiskScore: combinedScore,
        riskCategory,
        statusWording,
        recommendation,
        weatherSnapshot: {
          temp: weatherInfo.current.temperature,
          humidity: weatherInfo.current.humidity,
          condition: weatherInfo.current.condition,
          rain: weatherInfo.current.rain1h
        },
        forecastSnapshot: (weatherInfo.forecast || []).slice(0, 4),
        modelVersion: 'outbreak-risk-v1.2',
        updatedAt: new Date()
      };

      // Persist in DB
      if (isConnected) {
        await Outbreak.findOneAndUpdate(
          { district: cluster.district, diseaseCategory: cluster.diseaseCategory },
          outbreakDoc,
          { upsert: true, new: true }
        );
      } else {
        const existing = db.findAll('outbreaks', o => o.district === cluster.district && o.diseaseCategory === cluster.diseaseCategory);
        if (existing.length > 0) {
          db.updateById('outbreaks', existing[0].id, outbreakDoc);
        } else {
          db.create('outbreaks', { id: outbreakDoc.outbreakId, ...outbreakDoc });
        }
      }

      evaluatedOutbreaks.push(outbreakDoc);
    }

    return evaluatedOutbreaks;
  }

  /**
   * Return aggregated map data with 3 switchable layers:
   * 1. OBSERVED_CASES (case clusters, anonymized without farmer PII)
   * 2. ENVIRONMENTAL_RISK (OpenWeather humidity/vector zones)
   * 3. COMBINED_RISK (heat map intensities)
   */
  async getSurveillanceMapLayers() {
    let outbreaks = [];
    if (isConnected) {
      outbreaks = await Outbreak.find({}).lean();
    } else {
      outbreaks = db.findAll('outbreaks');
    }

    // Default geographic seed if database is newly initialized
    if (!outbreaks || outbreaks.length === 0) {
      await this.evaluateAllDistricts();
      if (isConnected) outbreaks = await Outbreak.find({}).lean();
      else outbreaks = db.findAll('outbreaks');
    }

    const observedCasesLayer = outbreaks.map(o => ({
      id: o.outbreakId || o._id,
      title: `${o.diseaseCategory} Case Cluster`,
      coordinates: o.location ? o.location.coordinates : [73.8567, 18.5204],
      caseCount: o.caseCount || 1,
      district: o.district || 'Pune',
      severity: o.riskCategory,
      type: 'OBSERVED_CASE_CLUSTER',
      radiusMeters: Math.min((o.caseCount || 1) * 3000, 25000),
      label: `${o.caseCount} observed cases (${o.district})`
    }));

    const environmentalRiskLayer = outbreaks.map(o => ({
      id: `env-${o.outbreakId || o._id}`,
      title: `${o.district} Vector & Weather Risk`,
      coordinates: o.location ? o.location.coordinates : [73.8567, 18.5204],
      environmentalScore: o.environmentalScore || 20,
      temperature: o.weatherSnapshot ? o.weatherSnapshot.temp : 29,
      humidity: o.weatherSnapshot ? o.weatherSnapshot.humidity : 70,
      condition: o.weatherSnapshot ? o.weatherSnapshot.condition : 'Humid',
      type: 'ENVIRONMENTAL_RISK',
      radiusMeters: 30000,
      label: `Env Score: ${o.environmentalScore}/50 (${o.weatherSnapshot ? o.weatherSnapshot.condition : 'Humid'})`
    }));

    const combinedRiskHeatmapLayer = outbreaks.map(o => ({
      id: `heat-${o.outbreakId || o._id}`,
      district: o.district,
      coordinates: o.location ? o.location.coordinates : [73.8567, 18.5204],
      riskCategory: o.riskCategory,
      combinedScore: o.combinedRiskScore,
      statusWording: o.statusWording,
      recommendation: o.recommendation,
      radiusMeters: 35000,
      weight: (o.combinedRiskScore || 30) / 100
    }));

    return {
      timestamp: new Date().toISOString(),
      layers: {
        OBSERVED_CASES: observedCasesLayer,
        ENVIRONMENTAL_RISK: environmentalRiskLayer,
        COMBINED_RISK: combinedRiskHeatmapLayer
      }
    };
  }
}

module.exports = new OutbreakRiskEngine();
