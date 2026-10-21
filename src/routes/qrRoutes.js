'use strict';

const express = require('express');
const controller = require('../controllers/qrController');
const { requireAuth } = require('../middleware/authenticate');
const { requireRole, requireEventAccess } = require('../middleware/authorize');
const { qrLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

router.post('/:id(\\d+)/qr/issue', requireAuth, requireEventAccess('id'), qrLimiter, controller.issueApi);
router.post('/:id(\\d+)/qr/revoke', requireAuth, requireRole('admin'), controller.revokeApi);

module.exports = router;
