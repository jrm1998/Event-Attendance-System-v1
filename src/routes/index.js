'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/authenticate');
const { requireRole } = require('../middleware/authorize');
const dashboardController = require('../controllers/dashboardController');

const apiRouter = express.Router();
apiRouter.use('/auth', require('./authRoutes'));
apiRouter.use('/students', require('./studentRoutes'));
apiRouter.use('/users', require('./userRoutes'));
apiRouter.use('/structure', require('./structureRoutes'));
apiRouter.use('/events', require('./eventRoutes'));
apiRouter.use('/events', require('./qrRoutes'));
apiRouter.use('/events', require('./reportRoutes'));
apiRouter.use('/attendance', require('./attendanceRoutes'));
apiRouter.use('/notifications', require('./notificationRoutes'));
apiRouter.use('/push', require('./pushRoutes'));
apiRouter.get('/admin/summary', requireAuth, requireRole('admin'), dashboardController.summaryApi);

const pagesRouter = express.Router();
pagesRouter.use(require('./pageRoutes'));

module.exports = { api: apiRouter, pages: pagesRouter };
