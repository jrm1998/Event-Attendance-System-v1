'use strict';

const express = require('express');
const controller = require('../controllers/notificationController');
const { requireAuth } = require('../middleware/authenticate');

const router = express.Router();

// The /api mount already applies apiLimiter; applying it here too halved
// the effective limit.
router.use(requireAuth);

router.get('/', controller.listApi);
router.get('/unread-count', controller.unreadCountApi);
router.post('/mark-read', controller.markReadApi);
router.post('/mark-all-read', controller.markAllReadApi);
router.get('/preferences', controller.preferencesApi);
router.put('/preferences', controller.updatePreferencesApi);

module.exports = router;
