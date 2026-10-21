'use strict';

const express = require('express');
const controller = require('../controllers/structureController');
const { requireRole } = require('../middleware/authorize');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

router.use(requireRole('admin'));

router.get('/', asyncHandler(controller.listApi));
router.post('/school-years', ...controller.createYearApi);
router.put('/school-years/:id(\\d+)', ...controller.updateYearApi);
router.post('/school-years/:id(\\d+)/activate', ...controller.activateYearApi);
router.post('/grade-levels', ...controller.createGradeApi);
router.post('/sections', ...controller.createSectionApi);
router.put('/sections/:id(\\d+)', ...controller.updateSectionApi);

module.exports = router;
