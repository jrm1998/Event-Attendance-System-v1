'use strict';

const express = require('express');
const controller = require('../controllers/eventController');
const attendanceController = require('../controllers/attendanceController');
const { requireAuth } = require('../middleware/authenticate');
const { requireRole, requireEventAccess } = require('../middleware/authorize');

const router = express.Router();

router.get('/', requireRole('admin', 'teacher'), ...controller.listApi);
router.get('/students/search', requireRole('admin'), controller.studentsSearchApi);
router.post(
  '/',
  requireRole('admin'),
  ...controller.createApi
);
router.get('/:id(\\d+)', requireAuth, requireEventAccess('id'), controller.getApi);
router.put('/:id(\\d+)', requireRole('admin'), ...controller.updateApi);
router.post('/:id(\\d+)/status/:action(publish|cancel|complete|archive)', requireRole('admin'), controller.actionApi);
router.get('/:id(\\d+)/eligible-count', requireRole('admin', 'teacher'), controller.eligibleCountApi);

// Event-scoped attendance management (admin or assigned teacher).
router.get('/:id(\\d+)/students/search', requireAuth, requireEventAccess('id'), ...controller.eventStudentsSearchApi);
router.get('/:id(\\d+)/attendance', requireAuth, requireEventAccess('id'), ...controller.attendanceListApi);
router.post('/:id(\\d+)/attendance/manual', requireAuth, requireEventAccess('id'), ...attendanceController.manualEntryApi);

module.exports = router;
