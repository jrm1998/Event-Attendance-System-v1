'use strict';

const express = require('express');
const controller = require('../controllers/notificationController');
const { requireAuth } = require('../middleware/authenticate');

const router = express.Router();

// The /api mount already applies apiLimiter; applying it here too halved
// the effective limit.
router.use(requireAuth);

// VAPID public key must be readable before a subscription exists.
router.get('/vapid-public', controller.vapidPublicApi);
router.post('/subscribe', controller.subscribeApi);
router.post('/unsubscribe', controller.unsubscribeApi);

module.exports = router;
