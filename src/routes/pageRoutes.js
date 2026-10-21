'use strict';

const express = require('express');
const controller = require('../controllers/authController');
const dashboardController = require('../controllers/dashboardController');
const studentController = require('../controllers/studentController');
const eventController = require('../controllers/eventController');
const userController = require('../controllers/userController');
const structureController = require('../controllers/structureController');
const attendanceController = require('../controllers/attendanceController');
const notificationController = require('../controllers/notificationController');
const reportController = require('../controllers/reportController');
const qrController = require('../controllers/qrController');
const settingsController = require('../controllers/settingsController');
const { requireAuth } = require('../middleware/authenticate');
const { requireRole, requireEventAccess } = require('../middleware/authorize');
const { loginLimiter } = require('../middleware/rateLimiter');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

router.get('/', (req, res) => {
  if (req.user) return res.redirect(controller.homePathFor(req.user));
  return res.redirect('/login');
});

router.get('/login', asyncHandler(controller.getLogin));
// These exports are validator/handler arrays; Express runs arrays natively and
// each handler is already async-wrapped. Wrapping the array itself breaks it.
router.post('/login', loginLimiter, controller.postLogin);
router.post('/logout', controller.postLogout);

router.get('/profile', requireAuth, asyncHandler(controller.getProfile));
router.post('/profile/password', requireAuth, controller.postChangePassword);

// --- Admin pages -----------------------------------------------------------
router.get('/admin', requireAuth, requireRole('admin'), asyncHandler(dashboardController.adminPage));
router.get('/admin/students', requireAuth, requireRole('admin'), asyncHandler(studentController.listPage));
router.get('/admin/students/new', requireAuth, requireRole('admin'), asyncHandler(studentController.formPage));
router.get('/admin/students/import', requireAuth, requireRole('admin'), asyncHandler(studentController.importPage));
router.get('/admin/students/:id(\\d+)/edit', requireAuth, requireRole('admin'), asyncHandler(studentController.formPage));
router.get('/admin/users', requireAuth, requireRole('admin'), asyncHandler(userController.listPage));
router.get('/admin/structure', requireAuth, requireRole('admin'), asyncHandler(structureController.structurePage));
router.get('/admin/events', requireAuth, requireRole('admin'), asyncHandler(eventController.listPage));
router.get('/admin/events/new', requireAuth, requireRole('admin'), asyncHandler(eventController.newPage));
router.get('/admin/events/:id(\\d+)/edit', requireAuth, requireRole('admin'), asyncHandler(eventController.editPage));
router.get(
  '/admin/events/:id(\\d+)/attendance',
  requireAuth,
  requireRole('admin'),
  requireEventAccess('id'),
  asyncHandler(attendanceController.eventManagePage)
);
router.get('/admin/review', requireAuth, requireRole('admin'), asyncHandler(attendanceController.reviewQueuePage));
router.get('/admin/audit', requireAuth, requireRole('admin'), asyncHandler(reportController.auditPage));
router.get('/admin/reports', requireAuth, requireRole('admin'), asyncHandler(reportController.adminReportsPage));
router.get('/admin/settings', requireAuth, requireRole('admin'), asyncHandler(settingsController.settingsPage));
router.post('/admin/settings', requireAuth, requireRole('admin'), asyncHandler(settingsController.updateSettings));

// --- Teacher pages -----------------------------------------------------------
router.get('/teacher', requireAuth, requireRole('teacher'), asyncHandler(dashboardController.teacherPage));
router.get('/teacher/events', requireAuth, requireRole('teacher'), asyncHandler(dashboardController.teacherEventsPage));
router.get('/teacher/manual', requireAuth, requireRole('teacher'), asyncHandler(reportController.teacherManualPage));
router.get('/teacher/reports', requireAuth, requireRole('teacher'), asyncHandler(reportController.teacherReportsPage));
router.get(
  '/teacher/events/:id(\\d+)/attendance',
  requireAuth,
  requireRole('teacher'),
  requireEventAccess('id'),
  asyncHandler(attendanceController.eventManagePage)
);

// --- QR display screens (admin + assigned teachers) ---------------------------
router.get('/admin/events/:id(\\d+)/qr', requireAuth, requireRole('admin'), asyncHandler(qrController.displayPage));
router.get('/teacher/events/:id(\\d+)/qr', requireAuth, requireRole('teacher'), requireEventAccess('id'), asyncHandler(qrController.displayPage));

// --- Student pages ------------------------------------------------------------
router.get('/student', requireAuth, requireRole('student'), asyncHandler(attendanceController.studentDashboardPage));
router.get('/student/events/:id(\\d+)', requireAuth, requireRole('student'), asyncHandler(attendanceController.studentEventPage));
router.get('/student/events/:id(\\d+)/scan', requireAuth, requireRole('student'), asyncHandler(attendanceController.studentScanPage));
router.get('/student/history', requireAuth, requireRole('student'), asyncHandler(attendanceController.studentHistoryPage));

// --- Notifications (all roles) --------------------------------------------------
router.get('/notifications', requireAuth, asyncHandler(notificationController.notificationsPage));
router.get('/student/notifications', requireAuth, (req, res) => res.redirect('/notifications'));

module.exports = router;
