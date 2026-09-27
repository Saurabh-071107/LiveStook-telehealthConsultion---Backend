const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

// GET /api/marketplace/products
router.get('/products', authenticate, (req, res) => {
  try {
    const { category } = req.query;
    let products = db.findAll('products');
    if (category) products = products.filter(p => p.category === category);
    return res.json(products);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve products.' });
  }
});

// POST /api/marketplace/orders (Farmer buys feed/medicine)
router.post('/orders', authenticate, requireRole('farmer'), (req, res) => {
  try {
    const { items, deliveryAddress, paymentMethod } = req.body;
    if (!items || !items.length) {
      return res.status(400).json({ error: 'Cart items are required.' });
    }

    const totalAmount = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const newOrder = {
      id: `ord-${uuidv4().substring(0, 8)}`,
      farmerId: req.user.id,
      items,
      totalAmount,
      deliveryAddress: deliveryAddress || req.user.village || 'Registered Farm Address',
      paymentMethod: paymentMethod || 'Kisan Credit Card / UPI',
      status: 'dispatched',
      orderedAt: new Date().toISOString()
    };

    db.create('orders', newOrder);
    return res.status(201).json(newOrder);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to place order.' });
  }
});

// GET /api/marketplace/sell-listings (Browse animal & dairy listings - Only Govt Verified listings or farmer's own)
router.get('/sell-listings', authenticate, (req, res) => {
  try {
    const { category } = req.query;
    let listings = db.findAll('sellListings');

    // Filter to only verified listings OR listings owned by the logged-in user
    const currentUserId = req.user.id || req.user._id;
    listings = listings.filter(l => 
      l.verificationStatus === 'VERIFIED' || 
      l.isGovVerified === true ||
      l.farmerId === currentUserId
    );

    if (category) listings = listings.filter(l => l.category === category);
    return res.json(listings);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve sell listings.' });
  }
});

// POST /api/marketplace/sell-listings (Farmer sells livestock/produce -> Enters PENDING Govt Verification)
router.post('/sell-listings', authenticate, requireRole('farmer'), (req, res) => {
  try {
    const { title, category, expectedPrice, animalTag, description, photoUrl } = req.body;
    if (!title || !expectedPrice) {
      return res.status(400).json({ error: 'Title and expectedPrice are required.' });
    }

    const currentUserId = req.user.id || req.user._id;
    const newListing = {
      id: `sell-${uuidv4().substring(0, 8)}`,
      farmerId: currentUserId,
      farmerName: req.user.name || 'Registered Farmer',
      title,
      category: category || 'cow',
      expectedPrice: Number(expectedPrice),
      animalTag: animalTag || '',
      description: description || '',
      photoUrl: photoUrl || '',
      contactPhone: req.user.phone || '',
      village: req.user.village || 'Pune Rural',
      district: req.user.district || 'Pune',
      status: 'pending_verification',
      verificationStatus: 'PENDING',
      isGovVerified: false,
      createdAt: new Date().toISOString()
    };

    db.create('sellListings', newListing);

    // Notify Gov Admin via socket
    const io = req.app.get('io');
    if (io) {
      io.emit('new_farmer_sell_listing', newListing);
      io.emit('kpi_update', { type: 'NEW_MARKETPLACE_LISTING', listing: newListing });
    }

    return res.status(201).json(newListing);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to create sell listing.' });
  }
});

module.exports = router;
