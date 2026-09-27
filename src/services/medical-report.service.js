const { Animal, Case, Consultation, Diagnosis, Treatment, TestBooking, TestReport, Vaccination } = require('../models');
const { isConnected } = require('../db/mongo');
const db = require('../db');

/**
 * Animal Medical History & Report Service
 * Aggregates complete longitudinal medical record of an animal across:
 * - Demographics & Ear Tag
 * - Clinical Cases
 * - Symptoms & AI Assessments
 * - Vet Consultations & Final Diagnoses
 * - Diagnostic Lab Tests & Reports
 * - Prescription Treatments & Medicines
 * - Vaccinations & Schedules
 */
class MedicalReportService {
  /**
   * Aggregate full clinical history for an animal
   * @param {string} animalIdOrEarTag
   */
  async getFullMedicalHistory(animalIdOrEarTag) {
    let animal;
    if (isConnected) {
      animal = await Animal.findOne({
        $or: [{ animalId: animalIdOrEarTag }, { earTagId: animalIdOrEarTag }]
      }).lean();
    } else {
      animal = db.findAll('animals', a => a.id === animalIdOrEarTag || a.tagNumber === animalIdOrEarTag)[0];
    }

    if (!animal) {
      throw new Error(`Animal ${animalIdOrEarTag} not found.`);
    }

    const animalKey = animal.animalId || animal.id || animal.tagNumber;

    let cases = [];
    let diagnoses = [];
    let treatments = [];
    let labTests = [];
    let vaccinations = [];

    if (isConnected) {
      [cases, diagnoses, treatments, labTests, vaccinations] = await Promise.all([
        Case.find({ animalId: animal._id }).lean(),
        Diagnosis.find({ animalId: animal._id }).lean(),
        Treatment.find({ animalId: animal._id }).lean(),
        TestBooking.find({ animalId: animal._id }).populate('testReportId').lean(),
        Vaccination.find({ animalId: animal._id }).lean(),
      ]);
    } else {
      cases = db.findAll('cases', c => c.animalId === animal.id || c.animalTag === animal.tagNumber);
      diagnoses = db.findAll('diagnoses', d => d.animalId === animal.id);
      treatments = db.findAll('treatments', t => t.animalId === animal.id);
      labTests = db.findAll('testBookings', tb => tb.animalId === animal.id);
      vaccinations = db.findAll('vaccinationBookings', v => v.animalId === animal.id);
    }

    return {
      generatedAt: new Date().toISOString(),
      reportId: `REP-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`,
      animal: {
        animalId: animal.animalId || animal.id,
        earTagId: animal.earTagId || animal.tagNumber,
        type: animal.type || animal.species,
        breed: animal.breed,
        gender: animal.gender,
        age: animal.age || `${animal.ageYears || 3} years`,
        lactationStage: animal.lactationStage || 'N/A',
        healthStatus: animal.healthStatus || 'HEALTHY',
        registeredAt: animal.createdAt
      },
      summary: {
        totalCases: cases.length,
        totalDiagnoses: diagnoses.length,
        totalLabTests: labTests.length,
        totalVaccinations: vaccinations.length
      },
      cases: cases.map(c => ({
        caseId: c.caseId,
        date: c.createdAt,
        status: c.status,
        symptoms: c.majorSymptoms || c.symptoms || [],
        additionalNotes: c.additionalSymptoms || c.description || '',
        aiPreliminaryAssessment: c.aiAnalysis ? {
          riskLevel: c.aiAnalysis.riskLevel || c.aiAnalysis.risk_level,
          possibleConditions: c.aiAnalysis.possibleConditions || c.aiAnalysis.possible_conditions,
          recommendedTests: c.aiAnalysis.recommendedTests || c.aiAnalysis.recommended_tests,
          modelVersion: c.aiAnalysis.modelVersion || 'animal-health-v1'
        } : null
      })),
      diagnoses: diagnoses.map(d => ({
        diagnosisId: d.diagnosisId || d.id,
        caseId: d.caseId,
        date: d.createdAt,
        finalDiagnosis: d.finalDiagnosis || d.condition,
        differentialDiagnosis: d.differentialDiagnosis || [],
        clinicalFindings: d.clinicalFindings || d.notes,
        vetName: d.vetName || 'Attending Veterinarian'
      })),
      treatments: treatments.map(t => ({
        treatmentId: t.treatmentId || t.id,
        caseId: t.caseId,
        date: t.createdAt,
        diagnosis: t.diagnosisSummary || t.diagnosis,
        medicines: t.medicines || [],
        durationDays: t.durationDays || 5,
        followUpDate: t.followUpDate,
        specialInstructions: t.specialInstructions || t.instructions
      })),
      laboratoryTests: labTests.map(t => ({
        bookingId: t.bookingId || t.id,
        testType: t.testType,
        status: t.status,
        labName: t.labName || 'State Veterinary Diagnostic Lab',
        scheduledDate: t.scheduledDate,
        report: t.testReportId || t.report || null
      })),
      vaccinations: vaccinations.map(v => ({
        vaccineName: v.vaccineName || v.vaccine,
        administeredDate: v.administeredDate || v.bookingDate,
        nextDueDate: v.nextDueDate,
        batchNumber: v.batchNumber || 'N/A',
        status: v.status || 'COMPLETED'
      }))
    };
  }

  /**
   * Render printable HTML medical certificate format
   */
  generateHtmlReport(history) {
    const { animal, cases, diagnoses, treatments, laboratoryTests, vaccinations } = history;
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Livestock Health Dossier - ${animal.earTagId}</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 24px; color: #1e293b; background: #fff; }
    .header { border-bottom: 3px solid #059669; padding-bottom: 16px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: flex-end; }
    h1 { color: #065f46; margin: 0; font-size: 22px; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 9999px; font-size: 12px; font-weight: 600; background: #d1fae5; color: #065f46; }
    .section { margin-bottom: 24px; }
    .section-title { font-size: 15px; font-weight: bold; color: #0f766e; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 13px; }
    th, td { border: 1px solid #e2e8f0; padding: 8px 12px; text-align: left; }
    th { background: #f8fafc; color: #475569; font-weight: 600; }
    .footer { margin-top: 36px; padding-top: 12px; border-top: 1px dashed #cbd5e1; font-size: 11px; color: #64748b; text-align: center; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>Department of Animal Husbandry & Veterinary Services</h1>
      <p style="margin: 4px 0 0 0; color: #475569; font-size: 14px;">Official Comprehensive Livestock Health & Diagnostic Dossier</p>
    </div>
    <div style="text-align: right;">
      <span class="badge">OFFICIAL MEDICAL RECORD</span>
      <div style="font-size: 12px; color: #64748b; margin-top: 4px;">Dossier ID: ${history.reportId}</div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Animal Identification & Demographics</div>
    <table>
      <tr>
        <th>Ear Tag ID</th><td><strong>${animal.earTagId}</strong></td>
        <th>System Animal ID</th><td>${animal.animalId}</td>
      </tr>
      <tr>
        <th>Species / Type</th><td>${animal.type}</td>
        <th>Breed</th><td>${animal.breed}</td>
      </tr>
      <tr>
        <th>Gender & Age</th><td>${animal.gender}, ${animal.age}</td>
        <th>Health Status</th><td>${animal.healthStatus}</td>
      </tr>
    </table>
  </div>

  <div class="section">
    <div class="section-title">Verified Veterinary Diagnoses & Prescriptions</div>
    ${diagnoses.length === 0 ? '<p style="font-size: 13px; color: #94a3b8;">No confirmed pathological diagnoses recorded.</p>' : `
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Case ID</th>
            <th>Final Diagnosis</th>
            <th>Clinical Observations</th>
            <th>Attending Doctor</th>
          </tr>
        </thead>
        <tbody>
          ${diagnoses.map(d => `
            <tr>
              <td>${new Date(d.date).toLocaleDateString()}</td>
              <td>${d.caseId}</td>
              <td><strong>${d.finalDiagnosis}</strong></td>
              <td>${d.clinicalFindings || 'N/A'}</td>
              <td>${d.vetName}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `}
  </div>

  <div class="section">
    <div class="section-title">Prescribed Treatments & Drug Regimens</div>
    ${treatments.length === 0 ? '<p style="font-size: 13px; color: #94a3b8;">No active medical treatments recorded.</p>' : `
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Condition</th>
            <th>Prescribed Medicines</th>
            <th>Duration</th>
            <th>Follow-up Date</th>
          </tr>
        </thead>
        <tbody>
          ${treatments.map(t => `
            <tr>
              <td>${new Date(t.date).toLocaleDateString()}</td>
              <td>${t.diagnosis}</td>
              <td>${t.medicines.map(m => `${m.name} (${m.dosage}, ${m.frequency})`).join('; ')}</td>
              <td>${t.durationDays} days</td>
              <td>${t.followUpDate ? new Date(t.followUpDate).toLocaleDateString() : 'None'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `}
  </div>

  <div class="section">
    <div class="section-title">Diagnostic Laboratory Investigations</div>
    ${laboratoryTests.length === 0 ? '<p style="font-size: 13px; color: #94a3b8;">No laboratory diagnostic tests logged.</p>' : `
      <table>
        <thead>
          <tr>
            <th>Booking ID</th>
            <th>Test Investigation</th>
            <th>Laboratory</th>
            <th>Status</th>
            <th>Result Summary</th>
          </tr>
        </thead>
        <tbody>
          ${laboratoryTests.map(l => `
            <tr>
              <td>${l.bookingId}</td>
              <td>${l.testType}</td>
              <td>${l.labName}</td>
              <td>${l.status}</td>
              <td>${l.report ? (l.report.resultSummary || 'Normal / Negative') : 'Awaiting Lab Processing'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `}
  </div>

  <div class="section">
    <div class="section-title">Vaccination Record & Prophylaxis</div>
    ${vaccinations.length === 0 ? '<p style="font-size: 13px; color: #94a3b8;">No official vaccination records found.</p>' : `
      <table>
        <thead>
          <tr>
            <th>Vaccine</th>
            <th>Date Administered</th>
            <th>Next Due Date</th>
            <th>Batch No</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${vaccinations.map(v => `
            <tr>
              <td><strong>${v.vaccineName}</strong></td>
              <td>${new Date(v.administeredDate).toLocaleDateString()}</td>
              <td>${v.nextDueDate ? new Date(v.nextDueDate).toLocaleDateString() : 'N/A'}</td>
              <td>${v.batchNumber}</td>
              <td>${v.status}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `}
  </div>

  <div class="footer">
    This clinical dossier is generated by Pashu Seva National Veterinary Telemedicine & Surveillance System.<br>
    All preliminary AI assessments are superseded by certified Veterinary Medical Officers.
  </div>
</body>
</html>
    `;
  }
}

module.exports = new MedicalReportService();
