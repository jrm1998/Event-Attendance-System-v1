'use strict';

const express = require('express');
const controller = require('../controllers/attendanceController');
const { requireAuth } = require('../middleware/authenticate');
const { requireRole } = require('../middleware/authorize');
const { attendanceLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// Students submit attendance; strict per-minute rate limiting.
router.post('/check-in', requireAuth, requireRole('student'), attendanceLimiter, ...controller.checkInApi);
router.post('/check-out', requireAuth, requireRole('student'), attendanceLimiter, ...controller.checkOutApi);
router.get('/mine', requireAuth, requireRole('student'), controller.mineApi);

// Coordinator actions — RBAC + event-assignment checks run inside the service.
router.post('/:id(\\d+)/review', requireAuth, requireRole('admin', 'teacher'), ...controller.reviewApi);
router.post('/:id(\\d+)/checkout', requireAuth, requireRole('admin', 'teacher'), ...controller.manualCheckOutApi);
router.post('/:id(\\d+)/status', requireAuth, requireRole('admin', 'teacher'), ...controller.correctionApi);
router.get('/:id(\\d+)/audit', requireAuth, requireRole('admin', 'teacher'), ...controller.auditApi);

module.exports = router;
