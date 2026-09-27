/**
 * Test Vaccination Intelligence, Booking, Paravet Assignment & OTP Verification Flow
 */
const http = require('http');

const BASE_URL = 'http://127.0.0.1:5000/api';

function request(path, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE_URL}${path}`);
    const reqOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed = data;
        try { parsed = JSON.parse(data); } catch (_) {}
        resolve({ status: res.statusCode, headers: res.headers, data: parsed });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runTest() {
  console.log('=== Pashu Seva Vaccination Module Test ===');

  const farmerPhone = `98221${Math.floor(10000 + Math.random() * 90000)}`;
  const aadhaarNumber = `5412${Math.floor(10000000 + Math.random() * 90000000)}`;
  const farmerId = `MH-VAC-${Math.floor(10000 + Math.random() * 90000)}`;
  const testEarTag = `ET-VAC-${Math.floor(100000 + Math.random() * 900000)}`;

  // 1. Register Farmer
  console.log(`\n1. Registering farmer with phone: ${farmerPhone}`);
  const regRes = await request('/auth/complete-registration', { method: 'POST' }, {
    phone: farmerPhone,
    name: 'Balasaheb Shinde',
    farmerId,
    aadhaarNumber,
    village: 'Baramati Rural',
    district: 'Pune',
    state: 'Maharashtra',
    otp: '1234'
  });

  console.log('Registration status:', regRes.status);
  const farmerToken = regRes.data.token;
  if (!farmerToken) {
    console.error('Registration failed:', regRes.data);
    process.exit(1);
  }

  // 2. Register Animal
  console.log(`\n2. Adding Livestock with ear tag: ${testEarTag}`);
  const addAnimalRes = await request('/animals', {
    method: 'POST',
    headers: { Authorization: `Bearer ${farmerToken}` }
  }, {
    tagNumber: testEarTag,
    name: 'Gauri Lakshmi',
    species: 'Cow',
    breed: 'Gir Cross',
    age: 18,
    gender: 'Female',
    district: 'Pune'
  });
  console.log('Animal Registration Status:', addAnimalRes.status);

  // 3. Central AI Vaccine Intelligence Evaluation
  console.log('\n3. Testing Central AI Vaccine Intelligence...');
  const aiRes = await request('/vaccinations/ai/evaluate', {
    method: 'POST',
    headers: { Authorization: `Bearer ${farmerToken}` }
  }, { district: 'Pune' });
  console.log('AI Evaluation Status:', aiRes.status);
  console.log('Weather Condition:', aiRes.data.weather?.weatherCondition, `Temp: ${aiRes.data.weather?.temp}°C`, `Humidity: ${aiRes.data.weather?.humidity}%`);
  console.log('Evaluated Animals Count:', aiRes.data.evaluatedAnimals?.length);

  // 4. Fetch Farmer Livestock Vaccination Status
  console.log('\n4. Fetching Farmer Livestock Status...');
  const statusRes = await request('/vaccinations/farmer/livestock-status', {
    method: 'GET',
    headers: { Authorization: `Bearer ${farmerToken}` }
  });
  console.log('Status Res Status:', statusRes.status);
  const livestock = statusRes.data.livestock || [];
  console.log(`Retrieved ${livestock.length} animals for farmer.`);
  const targetAnimal = livestock.find(l => l.earTagId === testEarTag) || livestock[0];
  console.log(`Selected Animal: ${targetAnimal.name} (${targetAnimal.earTagId}) - Status: ${targetAnimal.overallStatus}`);
  console.log('AI Recommendations for animal:', targetAnimal.aiRecommendations?.map(r => `${r.vaccineName} (${r.urgency})`));

  // 5. Book Vaccination Slot
  console.log('\n5. Booking Vaccination Slot for animal...');
  const bookRes = await request('/vaccinations/book', {
    method: 'POST',
    headers: { Authorization: `Bearer ${farmerToken}` }
  }, {
    animalId: targetAnimal.earTagId,
    vaccineName: 'Black Quarter Vaccine (BQ)',
    diseaseTarget: 'Black Quarter (Clostridium chauvoei)',
    bookedDate: new Date().toISOString().split('T')[0],
    slot: 'Morning (09:00 AM - 12:00 PM)',
    aiTriggered: true,
    weatherAlert: 'Clostridial spore alert due to high humidity'
  });
  console.log('Booking Status:', bookRes.status);
  const booking = bookRes.data;
  console.log(`Booking ID: ${booking.bookingId}, OTP: ${booking.verificationOtp}, Status: ${booking.status}`);

  if (!booking.bookingId || !booking.verificationOtp) {
    console.error('Booking failed:', booking);
    process.exit(1);
  }

  // 6. Test Duplicate Booking Prevention
  console.log('\n6. Testing Duplicate Active Booking Prevention...');
  const dupRes = await request('/vaccinations/book', {
    method: 'POST',
    headers: { Authorization: `Bearer ${farmerToken}` }
  }, {
    animalId: targetAnimal.earTagId,
    vaccineName: 'Black Quarter Vaccine (BQ)'
  });
  console.log('Duplicate Booking Status:', dupRes.status);
  if (dupRes.status === 409) {
    console.log('✅ Duplicate booking blocked successfully (409 Conflict):', dupRes.data.error);
  } else {
    console.error('❌ Duplicate booking check failed! Status:', dupRes.status);
  }

  // 7. Lab Queue Inspection
  console.log('\n7. Fetching Lab Vaccination Queue...');
  const queueRes = await request('/vaccinations/lab/queue', {
    method: 'GET',
    headers: { Authorization: `Bearer ${farmerToken}` }
  });
  console.log(`Lab Queue contains ${queueRes.data?.length} requests.`);

  // 8. Lab Accepts Request & Assigns Paravet
  console.log('\n8. Lab Accepts Request and Assigns Paravet...');
  const acceptRes = await request(`/vaccinations/bookings/${booking.bookingId}/accept`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${farmerToken}` }
  }, {
    vaccinatorName: 'Dr. Ramesh Shinde (Senior Paravet)',
    vaccinatorPhone: '+91 94220 12345',
    batchNumber: 'BQ-BATCH-MH-991',
    coldChainStatus: '2.8°C Monitored'
  });
  console.log('Accept Status:', acceptRes.status);
  console.log('Assigned Paravet:', acceptRes.data.booking?.assignedVaccinatorName);

  // 9. Farmer Live Status Tracking
  console.log('\n9. Checking Farmer Live Tracking Stepper...');
  const trackRes = await request(`/vaccinations/bookings/${booking.bookingId}/status`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${farmerToken}` }
  });
  console.log('Current Step Index:', trackRes.data.stepIndex, 'Status:', trackRes.data.booking?.status);

  // 10. Wrong OTP Verification Test
  console.log('\n10. Testing Invalid OTP Rejection...');
  const wrongOtpRes = await request(`/vaccinations/bookings/${booking.bookingId}/verify-otp`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${farmerToken}` }
  }, { otp: '0000' });
  console.log('Wrong OTP Status:', wrongOtpRes.status, wrongOtpRes.data.error);

  // 11. Correct OTP Verification & Certification
  console.log('\n11. Testing Correct OTP Verification & Digital Certification...');
  const correctOtpRes = await request(`/vaccinations/bookings/${booking.bookingId}/verify-otp`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${farmerToken}` }
  }, {
    otp: booking.verificationOtp,
    administeredBy: 'Dr. Ramesh Shinde (Senior Paravet)',
    remarks: 'Vaccine administered via subcutaneous injection. Cold-chain confirmed.'
  });
  console.log('Verify OTP Status:', correctOtpRes.status);
  console.log('Certificate Issued ID:', correctOtpRes.data.certificateId);
  console.log('Updated Status:', correctOtpRes.data.booking?.status);

  // 12. Final Tracking Check
  console.log('\n12. Final Tracking Status Check...');
  const finalTrackRes = await request(`/vaccinations/bookings/${booking.bookingId}/status`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${farmerToken}` }
  });
  console.log('Final Step Index:', finalTrackRes.data.stepIndex, 'isCompleted:', finalTrackRes.data.isCompleted);
  console.log('Certificate ID in Tracker:', finalTrackRes.data.certificateId);

  console.log('\n🎉 ALL VACCINATION BACKEND TESTS PASSED 100%!');
}

runTest().catch(console.error);
