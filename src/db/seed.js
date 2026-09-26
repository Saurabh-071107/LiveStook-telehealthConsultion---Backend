/**
 * Database Seed / Verification Script for Pashu Seva
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');

console.log('Verifying Pashu Seva seed database...');
if (fs.existsSync(config.databasePath)) {
  const content = JSON.parse(fs.readFileSync(config.databasePath, 'utf-8'));
  console.log(`✓ Database verified at: ${config.databasePath}`);
  console.log(`  - Users: ${content.users?.length || 0}`);
  console.log(`  - Animals: ${content.animals?.length || 0}`);
  console.log(`  - Cases: ${content.cases?.length || 0}`);
  console.log(`  - Outbreaks: ${content.outbreaks?.length || 0}`);
  console.log(`  - Vaccination Schedules: ${content.vaccinationSchedules?.length || 0}`);
  console.log(`  - Products: ${content.products?.length || 0}`);
} else {
  console.error(`Database not found at ${config.databasePath}. Please verify path.`);
}
