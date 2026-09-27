const mongoose = require('mongoose');

// =============================================================================
// 1. USER & ROLE-BASED PROFILES
// =============================================================================

const userSchema = new mongoose.Schema(
  {
    email: { type: String, lowercase: true, trim: true, index: true },
    phone: { type: String, required: true, trim: true, unique: true, index: true },
    password: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    role: {
      type: String,
      required: true,
      enum: ['FARMER', 'VETERINARIAN', 'LAB_STAFF', 'ADMIN'],
      index: true,
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const farmerSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    name: { type: String, required: true },
    phone: { type: String, required: true },
    email: { type: String, default: '' },
    address: { type: String, default: '' },
    postalCode: { type: String, required: true, index: true },
    district: { type: String, required: true, index: true },
    state: { type: String, required: true },
    country: { type: String, default: 'India' },
    village: { type: String, default: '' },
    aadhaarNumber: { type: String, default: '' },
    aadhaarVerified: { type: Boolean, default: false },
    animalsCount: { type: Number, default: 0 },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: [73.8567, 18.5204] }, // [lng, lat]
    },
  },
  { timestamps: true }
);
farmerSchema.index({ location: '2dsphere' });

const veterinarianSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    doctorId: { type: String, required: true, unique: true, index: true }, // State veterinary council reg number
    name: { type: String, required: true },
    phone: { type: String, required: true },
    email: { type: String, default: '' },
    qualification: { type: String, default: 'B.V.Sc & A.H.' },
    specialization: { type: String, default: 'General Veterinary Medicine' },
    hospitalClinic: { type: String, default: 'Government Veterinary Dispensary' },
    experienceYears: { type: Number, default: 5 },
    district: { type: String, required: true, index: true },
    state: { type: String, required: true },
    verificationStatus: {
      type: String,
      enum: ['PENDING', 'VERIFIED', 'REJECTED'],
      default: 'PENDING',
      index: true,
    },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    verifiedAt: { type: Date },
    rejectionReason: { type: String, default: '' },
    isAvailableForEmergency: { type: Boolean, default: true },
    currentWorkload: { type: Number, default: 0 },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: [73.8567, 18.5204] },
    },
  },
  { timestamps: true }
);
veterinarianSchema.index({ location: '2dsphere' });

const labStaffSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    laboratoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Laboratory', required: true, index: true },
    designation: { type: String, default: 'Laboratory Technician' },
    licenseNumber: { type: String, default: '' },
  },
  { timestamps: true }
);

const laboratorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    code: { type: String, required: true, unique: true, index: true },
    address: { type: String, default: '' },
    district: { type: String, required: true, index: true },
    state: { type: String, required: true },
    postalCode: { type: String, default: '' },
    phone: { type: String, default: '' },
    email: { type: String, default: '' },
    supportedTests: [
      {
        name: { type: String, required: true },
        code: { type: String, required: true },
        fee: { type: Number, default: 0 },
        turnaroundHours: { type: Number, default: 24 },
      },
    ],
    active: { type: Boolean, default: true },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: [73.8567, 18.5204] },
    },
  },
  { timestamps: true }
);
laboratorySchema.index({ location: '2dsphere' });

// =============================================================================
// 2. LIVESTOCK & 4-SIDE IMAGES
// =============================================================================

const animalSchema = new mongoose.Schema(
  {
    animalId: { type: String, required: true, unique: true, index: true }, // ANM-2026-XXXXXX
    earTagId: { type: String, required: true, unique: true, index: true }, // Unique ear tag
    farmerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Farmer', required: true, index: true },
    name: { type: String, required: true },
    species: { type: String, required: true, index: true }, // Cow, Buffalo, Goat, Sheep, etc.
    breed: { type: String, required: true },
    gender: { type: String, required: true, enum: ['Female', 'Male'] },
    ageYears: { type: Number, required: true },
    lactationStage: { type: String, default: 'Non-Lactating' },
    dailyMilkYieldLiters: { type: Number, default: 0 },
    photoUrl: { type: String, default: 'assets/images/animal_cow.png' },
    vaccinationStatus: { type: String, default: 'Up to Date' },
    healthStatus: { type: String, default: 'Healthy' },
    treatmentInfo: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

const animalImageSchema = new mongoose.Schema(
  {
    animalId: { type: String, required: true, index: true },
    caseId: { type: String, index: true },
    imageUrl: { type: String, required: true },
    viewType: {
      type: String,
      required: true,
      enum: ['FRONT', 'BACK', 'LEFT', 'RIGHT', 'AFFECTED_AREA', 'GENERAL'],
    },
    uploadedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// =============================================================================
// 3. CLINICAL CASES, SYMPTOMS & AI ANALYSES
// =============================================================================

const caseSchema = new mongoose.Schema(
  {
    caseId: { type: String, required: true, unique: true, index: true }, // CASE-2026-XXXXXX
    animalId: { type: String, required: true, index: true },
    farmerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Farmer', required: true, index: true },
    vetId: { type: mongoose.Schema.Types.ObjectId, ref: 'Veterinarian', index: true },
    majorSymptoms: [{ type: String }],
    additionalSymptoms: { type: String, default: '' },
    images: [{ type: String }],
    priority: { type: String, default: 'Medium', enum: ['Low', 'Medium', 'High', 'Critical'] },
    status: {
      type: String,
      required: true,
      default: 'CREATED',
      enum: [
        'CREATED',
        'AI_PROCESSING',
        'AI_ANALYZED',
        'LOW_RISK',
        'VET_REQUIRED',
        'QUEUED',
        'VET_ASSIGNED',
        'PENDING_ACCEPTANCE',
        'ACCEPTED',
        'APPOINTMENT_SCHEDULED',
        'WAITING',
        'CONSULTATION_ACTIVE',
        'CONSULTATION_COMPLETED',
        'TEST_RECOMMENDED',
        'TEST_BOOKED',
        'TEST_IN_PROGRESS',
        'REPORT_AVAILABLE',
        'DIAGNOSIS_COMPLETED',
        'TREATMENT_CREATED',
        'FOLLOW_UP',
        'CLOSED',
        'CANCELLED',
      ],
      index: true,
    },
    assignedAt: { type: Date },
    acceptedAt: { type: Date },
    completedAt: { type: Date },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: [73.8567, 18.5204] },
    },
  },
  { timestamps: true }
);
caseSchema.index({ location: '2dsphere' });

const aiAnalysisSchema = new mongoose.Schema(
  {
    caseId: { type: String, required: true, unique: true, index: true },
    animalId: { type: String, required: true, index: true },
    riskLevel: { type: String, required: true, enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
    possibleConditions: [
      {
        name: { type: String, required: true },
        probability: { type: Number, required: true },
        severity: { type: String, default: 'Moderate' },
      },
    ],
    confidence: { type: Number, required: true },
    recommendedTests: [{ type: String }],
    requiresVeterinarian: { type: Boolean, default: true },
    environmentalFactors: [{ type: String }],
    explanation: { type: String, default: '' },
    modelVersion: { type: String, required: true, default: 'animal-health-v1' },
  },
  { timestamps: true }
);

// =============================================================================
// 4. APPOINTMENTS, QUEUES & TELECONSULTATION
// =============================================================================

const appointmentSchema = new mongoose.Schema(
  {
    appointmentId: { type: String, required: true, unique: true, index: true },
    caseId: { type: String, required: true, index: true },
    farmerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Farmer', required: true, index: true },
    vetId: { type: mongoose.Schema.Types.ObjectId, ref: 'Veterinarian', required: true, index: true },
    scheduledDate: { type: String, required: true },
    scheduledTime: { type: String, required: true },
    startTime: { type: Date, required: true, index: true },
    endTime: { type: Date },
    type: { type: String, default: 'video_call', enum: ['video_call', 'in_person'] },
    status: {
      type: String,
      required: true,
      default: 'SCHEDULED',
      enum: ['SCHEDULED', 'WAITING', 'READY', 'ACTIVE', 'COMPLETED', 'MISSED', 'CANCELLED'],
      index: true,
    },
    callRoomId: { type: String, required: true },
    agoraChannel: { type: String, required: true },
    callStartedAt: { type: Date },
    callEndedAt: { type: Date },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);

const consultationQueueSchema = new mongoose.Schema(
  {
    callId: { type: String, required: true, unique: true, index: true }, // CALL-2026-XXXXXX
    caseId: { type: String, required: true, index: true },
    appointmentId: { type: String, required: true, index: true },
    farmerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Farmer', required: true, index: true },
    vetId: { type: mongoose.Schema.Types.ObjectId, ref: 'Veterinarian', required: true, index: true },
    position: { type: Number, required: true, default: 1 },
    expectedWaitTime: { type: String, default: '2-4 mins' },
    symptoms: [{ type: String }],
    description: { type: String, default: '' },
    photos: [{ type: String }],
    status: { type: String, default: 'WAITING', enum: ['WAITING', 'IN_CALL', 'COMPLETED', 'ABANDONED'] },
  },
  { timestamps: true }
);

const consultationSchema = new mongoose.Schema(
  {
    caseId: { type: String, required: true, index: true },
    appointmentId: { type: String, required: true, index: true },
    vetId: { type: mongoose.Schema.Types.ObjectId, ref: 'Veterinarian', required: true, index: true },
    farmerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Farmer', required: true, index: true },
    animalId: { type: String, required: true, index: true },
    clinicalObservations: { type: String, default: '' },
    callDurationSeconds: { type: Number, default: 0 },
    completedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// =============================================================================
// 5. DIAGNOSES, TREATMENTS & PRESCRIPTIONS
// =============================================================================

const diagnosisSchema = new mongoose.Schema(
  {
    caseId: { type: String, required: true, index: true },
    animalId: { type: String, required: true, index: true },
    vetId: { type: mongoose.Schema.Types.ObjectId, ref: 'Veterinarian', required: true, index: true },
    consultationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Consultation' },
    finalDiagnosis: { type: String, required: true },
    severity: { type: String, default: 'Moderate', enum: ['Mild', 'Moderate', 'Severe', 'Critical'] },
    clinicalNotes: { type: String, default: '' },
    supportingTestReports: [{ type: String }],
  },
  { timestamps: true }
);

const treatmentSchema = new mongoose.Schema(
  {
    caseId: { type: String, required: true, index: true },
    diagnosisId: { type: mongoose.Schema.Types.ObjectId, ref: 'Diagnosis', required: true, index: true },
    vetId: { type: mongoose.Schema.Types.ObjectId, ref: 'Veterinarian', required: true, index: true },
    farmerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Farmer', required: true, index: true },
    animalId: { type: String, required: true, index: true },
    diagnosisName: { type: String, required: true },
    medicines: [
      {
        name: { type: String, required: true },
        dosage: { type: String, required: true },
        frequency: { type: String, required: true },
        duration: { type: String, required: true },
        instructions: { type: String, default: '' },
      },
    ],
    dietaryInstructions: { type: String, default: '' },
    followUpDate: { type: String, default: '' },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);

// =============================================================================
// 6. LABORATORY BOOKINGS & REPORTS
// =============================================================================

const testBookingSchema = new mongoose.Schema(
  {
    testBookingId: { type: String, required: true, unique: true, index: true },
    caseId: { type: String, index: true },
    animalId: { type: String, required: true, index: true },
    farmerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Farmer', required: true, index: true },
    laboratoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Laboratory', required: true, index: true },
    testType: { type: String, required: true },
    slotDate: { type: String, required: true },
    slotTime: { type: String, required: true },
    status: {
      type: String,
      required: true,
      default: 'TEST_BOOKED',
      enum: ['TEST_RECOMMENDED', 'TEST_BOOKED', 'TEST_IN_PROGRESS', 'REPORT_AVAILABLE', 'COMPLETED', 'CANCELLED'],
      index: true,
    },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);

const testReportSchema = new mongoose.Schema(
  {
    testBookingId: { type: String, required: true, unique: true, index: true },
    animalId: { type: String, required: true, index: true },
    caseId: { type: String, index: true },
    laboratoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Laboratory', required: true, index: true },
    staffId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    testType: { type: String, required: true },
    resultSummary: { type: String, required: true },
    statusValue: { type: String, default: 'Normal', enum: ['Normal', 'Attention Required', 'Critical', 'Positive', 'Negative'] },
    parameters: [
      {
        parameter: { type: String, required: true },
        value: { type: String, required: true },
        unit: { type: String, default: '' },
        referenceRange: { type: String, default: '' },
        isNormal: { type: Boolean, default: true },
      },
    ],
    reportFileUrl: { type: String, default: '' },
    isFinalized: { type: Boolean, default: false },
    finalizedAt: { type: Date },
  },
  { timestamps: true }
);

// =============================================================================
// 7. VACCINATIONS & REMINDERS
// =============================================================================

const vaccinationSchema = new mongoose.Schema(
  {
    animalId: { type: String, required: true, index: true },
    farmerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Farmer', required: true, index: true },
    vaccineName: { type: String, required: true },
    diseaseTarget: { type: String, required: true },
    batchNumber: { type: String, default: 'BATCH-2026-VET' },
    administeredDate: { type: String, required: true },
    nextDueDate: { type: String, required: true, index: true },
    status: {
      type: String,
      required: true,
      default: 'COMPLETED',
      enum: ['COMPLETED', 'UPCOMING', 'OVERDUE'],
      index: true,
    },
    administeredBy: { type: String, default: 'Government Veterinary Officer' },
    vetId: { type: mongoose.Schema.Types.ObjectId, ref: 'Veterinarian' },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);

// =============================================================================
// 8. OUTBREAK SURVEILLANCE & ENVIRONMENTAL WEATHER
// =============================================================================

const outbreakSchema = new mongoose.Schema(
  {
    diseaseName: { type: String, required: true, index: true },
    region: { type: String, required: true },
    district: { type: String, required: true, index: true },
    state: { type: String, default: 'Maharashtra' },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], required: true }, // [lng, lat]
    },
    radiusKm: { type: Number, default: 25 },
    casesCount: { type: Number, default: 1 },
    timeWindowDays: { type: Number, default: 7 },
    observedCaseScore: { type: Number, default: 0 },
    environmentalScore: { type: Number, default: 0 },
    combinedRiskScore: { type: Number, default: 0 },
    riskCategory: {
      type: String,
      required: true,
      default: 'MODERATE',
      enum: ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'],
      index: true,
    },
    weatherSnapshot: { type: mongoose.Schema.Types.Mixed },
    forecastSnapshot: { type: mongoose.Schema.Types.Mixed },
    modelVersion: { type: String, default: 'outbreak-engine-v1' },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);
outbreakSchema.index({ location: '2dsphere' });

const weatherDataSchema = new mongoose.Schema(
  {
    postalCode: { type: String, required: true, unique: true, index: true },
    district: { type: String, required: true },
    state: { type: String, default: 'Maharashtra' },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], required: true },
    },
    current: {
      temp: { type: Number, required: true },
      tempFormatted: { type: String, default: '28°C' },
      condition: { type: String, default: 'Clear' },
      humidity: { type: Number, default: 60 },
      pressure: { type: Number, default: 1012 },
      windSpeed: { type: Number, default: 5 },
      clouds: { type: Number, default: 20 },
      rainfallMm: { type: Number, default: 0 },
    },
    forecast: [{ type: mongoose.Schema.Types.Mixed }],
    fetchedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true }
);
weatherDataSchema.index({ location: '2dsphere' });

// =============================================================================
// 9. AUDIT LOGS & NOTIFICATIONS
// =============================================================================

const auditLogSchema = new mongoose.Schema(
  {
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    actorRole: { type: String, default: 'SYSTEM' },
    action: { type: String, required: true, index: true },
    entityType: { type: String, required: true, index: true },
    entityId: { type: String, default: '' },
    details: { type: mongoose.Schema.Types.Mixed },
    ipAddress: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = {
  User: mongoose.model('User', userSchema),
  Farmer: mongoose.model('Farmer', farmerSchema),
  Veterinarian: mongoose.model('Veterinarian', veterinarianSchema),
  LabStaff: mongoose.model('LabStaff', labStaffSchema),
  Laboratory: mongoose.model('Laboratory', laboratorySchema),
  Animal: mongoose.model('Animal', animalSchema),
  AnimalImage: mongoose.model('AnimalImage', animalImageSchema),
  Case: mongoose.model('Case', caseSchema),
  AIAnalysis: mongoose.model('AIAnalysis', aiAnalysisSchema),
  Appointment: mongoose.model('Appointment', appointmentSchema),
  ConsultationQueue: mongoose.model('ConsultationQueue', consultationQueueSchema),
  Consultation: mongoose.model('Consultation', consultationSchema),
  Diagnosis: mongoose.model('Diagnosis', diagnosisSchema),
  Treatment: mongoose.model('Treatment', treatmentSchema),
  TestBooking: mongoose.model('TestBooking', testBookingSchema),
  TestReport: mongoose.model('TestReport', testReportSchema),
  Vaccination: mongoose.model('Vaccination', vaccinationSchema),
  Outbreak: mongoose.model('Outbreak', outbreakSchema),
  WeatherData: mongoose.model('WeatherData', weatherDataSchema),
  AuditLog: mongoose.model('AuditLog', auditLogSchema),
};
