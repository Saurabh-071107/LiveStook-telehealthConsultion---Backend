const express = require('express');
const router = express.Router();
const weatherService = require('../services/weather.service');
const { authenticate } = require('../middleware/auth');

// GET /api/weather (Query by Farmer PIN code with TTL caching)
router.get('/', authenticate, async (req, res) => {
  try {
    const pin = req.query.pin || req.user.postalCode || '411001';
    const weatherData = await weatherService.getWeatherByPin(pin);
    return res.json(weatherData);
  } catch (err) {
    console.error('Weather route error:', err);
    return res.status(500).json({ error: 'Failed to retrieve environmental weather data.' });
  }
});

// GET /api/weather/geocode (PIN to coordinates)
router.get('/geocode', authenticate, async (req, res) => {
  try {
    const pin = req.query.pin || '411001';
    const geo = await weatherService.geocodePinCode(pin);
    return res.json(geo);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to geocode postal code.' });
  }
});

module.exports = router;
