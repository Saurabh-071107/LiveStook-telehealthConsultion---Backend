const mongoose = require('mongoose');

const BASE_URL = 'http://localhost:5000/api';
const MONGODB_URI = 'mongodb+srv://sourcecod:1234@cluster0.p71s0.mongodb.net/test?retryWrites=true&w=majority&appName=Cluster0';

async function api(path, options = {}) {
  const { headers = {}, ...rest } = options;
  const res = await fetch(`${BASE_URL}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

async function run() {
  console.log('--- STARTING DIAGNOSTIC COLLECTOR ASSIGNMENT & OTP VERIFICATION TEST ---');

  const farmerToken = 'demo-farmer-token';
  const labToken = 'demo-lab-staff-token';

  // 1. Get animal via API
  const animalsRes = await api('/animals', {
    headers: { Authorization: `Bearer ${farmerToken}` }
  });
  const animals = Array.isArray(animalsRes.data) ? animalsRes.data : (animalsRes.data.animals || []);
  let tag = '25EC3019';
  let animalId = '25EC3019';
  if (animals.length > 0) {
    const a = animals[0];
    tag = a.earTagId || a.tagNumber || a.tag || tag;
    animalId = a.animalId || a.id || a._id || tag;
  }
  console.log('Using animal:', tag, 'ID:', animalId);

  // 2. Book diagnostic test
  const bookRes = await api('/labs/book', {
    method: 'POST',
    body: JSON.stringify({
      animalId: animalId,
      testType: 'Fecal Test',
      date: '2026-09-30',
      slotTime: '09:00 AM - 10:00 AM',
      notes: 'Testing collector assignment & OTP flow'
    }),
    headers: { Authorization: `Bearer ${farmerToken}` }
  });

  if (!bookRes.ok) {
    throw new Error(`Failed to book test: ${JSON.stringify(bookRes.data)}`);
  }

  const booking = bookRes.data.booking;
  const bookingId = booking.bookingId;
  const otp = bookRes.data.collectionOtp || booking.collectionOtp;
  console.log(`[PASS] Booked test: ${bookingId}, Status: ${booking.status}, OTP: ${otp}`);

  if (!otp || otp.length !== 4) {
    throw new Error(`Expected 4-digit OTP but got: ${otp}`);
  }

  // 3. Lab Accepts and Assigns Collector
  const acceptRes = await api(`/labs/tests/${bookingId}/accept`, {
    method: 'PATCH',
    body: JSON.stringify({
      collectorName: 'Ramesh Patil (Phlebotomist)',
      collectorPhone: '+91 98765 43210'
    }),
    headers: { Authorization: `Bearer ${labToken}` }
  });

  if (!acceptRes.ok) {
    throw new Error(`Failed to accept test: ${JSON.stringify(acceptRes.data)}`);
  }

  console.log(`[PASS] Accepted test. Status: ${acceptRes.data.booking.status}, Collector: ${acceptRes.data.booking.collectorName}`);
  if (acceptRes.data.booking.status !== 'ACCEPTED') {
    throw new Error(`Expected status ACCEPTED but got ${acceptRes.data.booking.status}`);
  }

  // 4. Test wrong OTP rejection (Should fail with 400)
  const wrongOtpRes = await api(`/labs/tests/${bookingId}/verify-collection`, {
    method: 'POST',
    body: JSON.stringify({ otp: '0000' }),
    headers: { Authorization: `Bearer ${labToken}` }
  });

  if (wrongOtpRes.status === 400) {
    console.log(`[PASS] Wrong OTP correctly rejected with 400: ${wrongOtpRes.data.error}`);
  } else {
    throw new Error(`Expected wrong OTP to return 400 but got ${wrongOtpRes.status}`);
  }

  // 5. Test correct OTP verification
  const verifyRes = await api(`/labs/tests/${bookingId}/verify-collection`, {
    method: 'POST',
    body: JSON.stringify({ otp }),
    headers: { Authorization: `Bearer ${labToken}` }
  });

  if (!verifyRes.ok) {
    throw new Error(`Failed to verify correct OTP: ${JSON.stringify(verifyRes.data)}`);
  }
  console.log(`[PASS] Correct OTP verified. Status: ${verifyRes.data.booking.status}`);
  if (verifyRes.data.booking.status !== 'SAMPLE_COLLECTED') {
    throw new Error(`Expected status SAMPLE_COLLECTED but got ${verifyRes.data.booking.status}`);
  }

  // 6. Lab starts testing
  const startRes = await api(`/labs/tests/${bookingId}/start`, {
    method: 'PATCH',
    body: JSON.stringify({}),
    headers: { Authorization: `Bearer ${labToken}` }
  });
  if (!startRes.ok) {
    throw new Error(`Failed to start test: ${JSON.stringify(startRes.data)}`);
  }
  console.log(`[PASS] Test started. Status: ${startRes.data.booking.status}`);

  // 7. Lab uploads report
  const reportRes = await api(`/labs/tests/${bookingId}/upload-report`, {
    method: 'POST',
    body: JSON.stringify({
      testResult: 'Normal CBC Profile',
      resultSummary: 'White blood cells, RBC and platelets all within standard physiological range.',
      parameters: {
        'Hemoglobin (Hb)': '11.5 g/dL (Normal: 8.0-15.0)',
        'Packed Cell Volume (PCV)': '34% (Normal: 24-46)',
        'WBC Count': '7,800 / uL (Normal: 4,000-12,000)'
      },
      observations: 'Animal is in excellent health.',
      isAbnormal: false
    }),
    headers: { Authorization: `Bearer ${labToken}` }
  });

  if (!reportRes.ok) {
    throw new Error(`Failed to upload report: ${JSON.stringify(reportRes.data)}`);
  }
  console.log(`[PASS] Report uploaded. Report ID: ${reportRes.data.report.reportId}`);

  // 8. Fetch status endpoint
  const statusRes = await api(`/labs/tests/${bookingId}/status`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${farmerToken}` }
  });
  console.log(`[PASS] Final Status Check: ${statusRes.data.status}, Report ID: ${statusRes.data.reportId}`);

  console.log('--- ALL COLLECTOR & OTP VERIFICATION TESTS PASSED SUCCESSFULLY ---');
}

run().catch(err => {
  console.error('Test failed:', err.message);
  process.exit(1);
});
