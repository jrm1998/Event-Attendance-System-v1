'use strict';

const express = require('express');
const controller = require('../controllers/userController');
const { requireRole } = require('../middleware/authorize');

const router = express.Router();

router.use(requireRole('admin'));

router.post('/', ...controller.createApi);
router.put('/:id(\\d+)/status', ...controller.updateStatusApi);
router.post('/:id(\\d+)/reset-password', ...controller.resetPasswordApi);

module.exports = router;
