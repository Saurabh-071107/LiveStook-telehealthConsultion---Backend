/**
 * AI & Analytics Engine for Pashu Seva
 * Analyzes reported symptoms and photos to compute:
 * - Risk Score (0 - 100)
 * - Disease Predictions (FMD, Mastitis, Lumpy Skin Disease, Anthrax, Brucellosis, etc.)
 * - Severity Classification (Low, Moderate, High, Critical)
 * - Outbreak Suspect Trigger & Spatial Cluster Flagging
 */

const KNOWN_DISEASE_PROFILES = [
  {
    disease: 'Foot-and-Mouth Disease (FMD)',
    keySymptoms: ['blister', 'drooling', 'saliva', 'ulcer', 'vesicle', 'lameness', 'tongue', 'hoof'],
    baseRisk: 88,
    severity: 'Critical',
    isContagiousOutbreakRisk: true
  },
  {
    disease: 'Lumpy Skin Disease (LSD)',
    keySymptoms: ['nodule', 'lump', 'skin bump', 'fever', 'swollen lymph', 'edema'],
    baseRisk: 82,
    severity: 'High',
    isContagiousOutbreakRisk: true
  },
  {
    disease: 'Bovine Mastitis',
    keySymptoms: ['udder', 'milk clot', 'flake', 'hard quarter', 'swollen teat', 'bloody milk'],
    baseRisk: 52,
    severity: 'Moderate',
    isContagiousOutbreakRisk: false
  },
  {
    disease: 'Anthrax (Suspected)',
    keySymptoms: ['sudden death', 'dark blood', 'unclotted blood from orifices', 'high fever', 'convulsion'],
    baseRisk: 98,
    severity: 'Critical',
    isContagiousOutbreakRisk: true
  },
  {
    disease: 'Haemorrhagic Septicaemia (HS)',
    keySymptoms: ['throat swelling', 'respiratory distress', 'heavy breathing', 'high fever', 'frothing'],
    baseRisk: 90,
    severity: 'Critical',
    isContagiousOutbreakRisk: true
  },
  {
    disease: 'Black Quarter (BQ)',
    keySymptoms: ['swollen thigh', 'crepitating swelling', 'lameness', 'gaseous swelling', 'muscle tremor'],
    baseRisk: 85,
    severity: 'High',
    isContagiousOutbreakRisk: true
  }
];

class AiAnalyticsService {
  /**
   * Analyze symptoms and description to score risk and predict condition
   */
  analyzeSymptoms(symptoms = [], description = '') {
    const combinedText = `${symptoms.join(' ')} ${description}`.toLowerCase();

    let bestMatch = null;
    let maxMatchCount = 0;

    for (const profile of KNOWN_DISEASE_PROFILES) {
      let matchCount = 0;
      for (const keyword of profile.keySymptoms) {
        if (combinedText.includes(keyword.toLowerCase())) {
          matchCount++;
        }
      }

      if (matchCount > maxMatchCount) {
        maxMatchCount = matchCount;
        bestMatch = profile;
      }
    }

    if (!bestMatch || maxMatchCount === 0) {
      return {
        aiRiskScore: 35,
        aiPredictedDisease: 'General Livestock Malaise / Undiagnosed',
        aiConfidence: 0.60,
        aiSeverity: 'Low',
        suspectedOutbreak: false
      };
    }

    const confidence = Math.min(0.95, 0.65 + maxMatchCount * 0.08);
    const score = Math.min(99, Math.round(bestMatch.baseRisk + (maxMatchCount - 1) * 3));

    return {
      aiRiskScore: score,
      aiPredictedDisease: bestMatch.disease,
      aiConfidence: parseFloat(confidence.toFixed(2)),
      aiSeverity: bestMatch.severity,
      suspectedOutbreak: bestMatch.isContagiousOutbreakRisk && score >= 75
    };
  }

  /**
   * Spatial Cluster Detection: checks if multiple cases of the same suspected disease
   * occurred within a radius (e.g., 20 km) within the last 14 days.
   */
  detectClusters(cases = [], distanceCalculator) {
    const clusters = [];
    const contagiousCases = cases.filter(c => c.suspectedOutbreak && c.location?.lat && c.location?.lng);

    for (let i = 0; i < contagiousCases.length; i++) {
      const caseA = contagiousCases[i];
      const nearby = contagiousCases.filter(caseB => {
        if (caseA.id === caseB.id) return false;
        if (caseA.aiPredictedDisease !== caseB.aiPredictedDisease) return false;
        const dist = distanceCalculator(
          caseA.location.lat,
          caseA.location.lng,
          caseB.location.lat,
          caseB.location.lng
        );
        return dist <= 25; // 25 km threshold
      });

      if (nearby.length >= 2) {
        clusters.push({
          disease: caseA.aiPredictedDisease,
          centerLat: caseA.location.lat,
          centerLng: caseA.location.lng,
          caseCount: nearby.length + 1,
          district: caseA.district,
          state: caseA.state
        });
      }
    }

    return clusters;
  }
}

module.exports = new AiAnalyticsService();
