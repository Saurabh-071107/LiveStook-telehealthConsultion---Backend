const fs = require('fs');
const path = require('path');
const config = require('../config');

// In-memory cache + persistent JSON backing
let dbCache = null;

function loadDatabase() {
  if (dbCache) return dbCache;
  try {
    if (!fs.existsSync(config.databasePath)) {
      const initialData = {
        users: [],
        animals: [],
        cases: [],
        appointments: [],
        vaccinationSchedules: [],
        vaccinationBookings: [],
        products: [],
        orders: [],
        sellListings: [],
        outbreaks: [],
        broadcasts: [],
        regulations: []
      };
      fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
      fs.writeFileSync(config.databasePath, JSON.stringify(initialData, null, 2), 'utf-8');
      dbCache = initialData;
      return dbCache;
    }

    const raw = fs.readFileSync(config.databasePath, 'utf-8');
    dbCache = JSON.parse(raw);
    return dbCache;
  } catch (err) {
    console.error('Error loading database:', err);
    throw err;
  }
}

function saveDatabase() {
  if (!dbCache) return;
  try {
    fs.writeFileSync(config.databasePath, JSON.stringify(dbCache, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving database:', err);
    throw err;
  }
}

const db = {
  getCollection: (name) => {
    const data = loadDatabase();
    if (!data[name]) data[name] = [];
    return data[name];
  },

  findAll: (collectionName, filterFn = null) => {
    const collection = db.getCollection(collectionName);
    return filterFn ? collection.filter(filterFn) : [...collection];
  },

  findById: (collectionName, id) => {
    const collection = db.getCollection(collectionName);
    return collection.find((item) => item.id === id) || null;
  },

  create: (collectionName, record) => {
    const collection = db.getCollection(collectionName);
    collection.push(record);
    saveDatabase();
    return record;
  },

  updateById: (collectionName, id, updates) => {
    const collection = db.getCollection(collectionName);
    const index = collection.findIndex((item) => item.id === id);
    if (index === -1) return null;
    collection[index] = { ...collection[index], ...updates, updatedAt: new Date().toISOString() };
    saveDatabase();
    return collection[index];
  },

  deleteById: (collectionName, id) => {
    const collection = db.getCollection(collectionName);
    const index = collection.findIndex((item) => item.id === id);
    if (index === -1) return false;
    collection.splice(index, 1);
    saveDatabase();
    return true;
  },

  // Helper for GIS distance calculation (Haversine formula in KM)
  calculateDistanceKm: (lat1, lon1, lat2, lon2) => {
    const R = 6371; // Earth's radius in km
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }
};

module.exports = db;
