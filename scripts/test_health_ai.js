async function testHealthAI() {
  const baseUrl = 'http://localhost:5000/api';
  console.log('Testing Health AI & Mandatory Photo Verification...');

  // 1. Login or create test farmer
  const testPhone = '98' + Math.floor(10000000 + Math.random() * 90000000);
  const regRes = await fetch(`${baseUrl}/auth/complete-registration`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Ramesh Farmer',
      phone: testPhone,
      aadhaarNumber: '9999' + Math.floor(10000000 + Math.random() * 90000000),
      farmerId: 'FID-' + Math.floor(100000 + Math.random() * 900000),
      otp: '1234'
    })
  });
  const regData = await regRes.json();
  const token = regData.token;
  console.log('1. Farmer registered, token acquired:', !!token);

  // 2. Register animal
  const earTag = 'TAG-' + Math.floor(100000 + Math.random() * 900000);
  const animRes = await fetch(`${baseUrl}/animals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: 'Nandi',
      species: 'Cow',
      breed: 'Gir',
      ageYears: 4,
      tagNumber: earTag
    })
  });
  const animData = await animRes.json();
  console.log('2. Animal registered:', animData.animalId || animData.id);

  // 3. Test photo verification with non-animal photo (e.g. invoice screenshot or human selfie)
  console.log('3. Testing rejection of non-animal photo...');
  const fakePhoto = 'data:image/png;base64,invoice_payment_screenshot_human_selfie_dummy_bytes_sample_12345678901234567890';
  const rejectRes = await fetch(`${baseUrl}/cases/verify-animal-photo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ imageBase64: fakePhoto, fileName: 'invoice_receipt.pdf' })
  });
  const rejectData = await rejectRes.json();
  console.log('Non-animal photo status:', rejectRes.status, 'Rejected properly:', !rejectData.isAnimal);

  // 4. Test photo verification with valid livestock photo
  console.log('4. Testing acceptance of valid livestock photo...');
  const validPhoto = 'data:image/jpeg;base64,' + 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='.repeat(5);
  const acceptRes = await fetch(`${baseUrl}/cases/verify-animal-photo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ imageBase64: validPhoto, fileName: 'cow_mouth_lesion.jpg' })
  });
  const acceptData = await acceptRes.json();
  console.log('Valid animal photo status:', acceptRes.status, 'Accepted properly:', acceptData.isAnimal);

  // 5. Test Case Submission WITHOUT photo (should be rejected)
  console.log('5. Testing case submission without photo...');
  const noPhotoRes = await fetch(`${baseUrl}/cases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      animalId: animData.animalId || animData.id,
      majorSymptoms: ['Fever', 'Blisters in mouth', 'Excessive drooling'],
      photoUrls: []
    })
  });
  console.log('No photo submission rejected:', noPhotoRes.status === 400);

  // 6. Test Case Submission WITH valid animal photo & FMD symptoms
  console.log('6. Testing case submission with FMD symptoms & animal photo...');
  const caseRes = await fetch(`${baseUrl}/cases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      animalId: animData.animalId || animData.id,
      majorSymptoms: ['Fever', 'Blisters in mouth', 'Excessive drooling', 'Limping on hoof'],
      description: 'Cow is salivating heavily and has vesicles on tongue with high temperature.',
      photoUrls: [validPhoto]
    })
  });
  const caseData = await caseRes.json();
  console.log('Case Created Status:', caseRes.status, 'Case ID:', caseData.caseId);
  console.log('Primary Condition:', caseData.preliminaryCondition);
  console.log('Severity Level:', caseData.severity);
  console.log('First Aid Count:', (caseData.aiAnalysis.firstAid || []).length);
  console.log('Recommended Tests:', caseData.aiAnalysis.recommendedTests);

  // 7. Verify Farmer Isolation (Farmer B cannot see Farmer A cases)
  const phoneB = '98' + Math.floor(10000000 + Math.random() * 90000000);
  const regB = await fetch(`${baseUrl}/auth/complete-registration`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Farmer B',
      phone: phoneB,
      aadhaarNumber: '9999' + Math.floor(10000000 + Math.random() * 90000000),
      farmerId: 'FID-' + Math.floor(100000 + Math.random() * 900000),
      otp: '1234'
    })
  });
  const dataB = await regB.json();
  const casesB = await fetch(`${baseUrl}/cases`, {
    headers: { Authorization: `Bearer ${dataB.token}` }
  });
  const listB = await casesB.json();
  console.log('Farmer B cases count (should be 0):', listB.length);
  console.log('User Isolation Verified:', listB.length === 0);
}

testHealthAI().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
