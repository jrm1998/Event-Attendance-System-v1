'use strict';

const express = require('express');
const controller = require('../controllers/studentController');
const { requireRole } = require('../middleware/authorize');
const uploadService = require('../services/uploadService');

const router = express.Router();

router.use(requireRole('admin'));

router.get('/:id(\\d+)', controller.getByIdApi);
router.post('/', ...controller.createApi);
router.put('/:id(\\d+)', ...controller.updateApi);
router.post('/bulk', ...controller.bulkApi);
router.post('/import/validate', uploadService.importUpload.single('file'), controller.importValidateApi);
router.post('/import/commit', uploadService.importUpload.single('file'), controller.importCommitApi);
router.get('/:id(\\d+)/history', controller.historyApi);

module.exports = router;
