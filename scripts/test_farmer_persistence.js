async function testPersistence() {
  const baseUrl = 'http://localhost:5000/api';
  const testPhone = '98' + Math.floor(10000000 + Math.random() * 90000000);
  const testAadhaar = '9999' + Math.floor(10000000 + Math.random() * 90000000);
  const testFarmerId = 'FID-' + Math.floor(100000 + Math.random() * 900000);
  const earTag = 'TAG-' + Math.floor(100000 + Math.random() * 900000);

  console.log(`Testing Registration with Phone: ${testPhone}, FarmerID: ${testFarmerId}`);

  // 1. Verify Aadhaar
  const vRes = await fetch(`${baseUrl}/auth/verify-aadhaar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      aadhaarNumber: testAadhaar,
      farmerId: testFarmerId,
      name: 'Ramesh Patil'
    })
  });
  const vData = await vRes.json();
  console.log('1. Aadhaar Verified:', vData.verified);

  // 2. Send OTP
  const otpRes = await fetch(`${baseUrl}/auth/send-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: testPhone,
      type: 'register'
    })
  });
  const otpData = await otpRes.json();
  console.log('2. OTP Sent:', otpData.otp);

  // 3. Complete Registration
  const regRes = await fetch(`${baseUrl}/auth/complete-registration`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Ramesh Patil',
      phone: testPhone,
      aadhaarNumber: testAadhaar,
      farmerId: testFarmerId,
      village: 'Khed',
      district: 'Pune',
      state: 'Maharashtra',
      otp: '1234'
    })
  });
  const regData = await regRes.json();
  console.log('3. Registration Completed. Token received:', !!regData.token, 'User:', regData.user);
  const token = regData.token;

  // 4. Register Animal
  console.log(`4. Registering Animal with tag: ${earTag}`);
  const animRes = await fetch(`${baseUrl}/animals`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      name: 'Gauri',
      species: 'Cow',
      breed: 'Gir',
      ageYears: 3,
      tagNumber: earTag,
      gender: 'Female'
    })
  });
  const animData = await animRes.json();
  console.log('Animal Registered Status:', animRes.status, 'Response:', animData);

  // 5. Fetch Animals for this user
  const listRes = await fetch(`${baseUrl}/animals`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const listData = await listRes.json();
  console.log('5. Fetched Animals Count:', listData.length);
  const found = listData.find(a => a.tagNumber === earTag || a.earTagId === earTag);
  console.log('Animal found in list:', !!found);

  // 6. Test Login with same phone
  console.log('6. Testing Login with same account...');
  const loginRes = await fetch(`${baseUrl}/auth/verify-otp-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: testPhone,
      otp: '1234'
    })
  });
  const loginData = await loginRes.json();
  console.log('Login successful:', !!loginData.token, 'Same FarmerID:', loginData.user?.farmerId === testFarmerId);

  // 7. Fetch with new login token
  const listAfterLogin = await fetch(`${baseUrl}/animals`, {
    headers: { 'Authorization': `Bearer ${loginData.token}` }
  });
  const listData2 = await listAfterLogin.json();
  console.log('Animals count after login:', listData2.length);
}

testPersistence().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
