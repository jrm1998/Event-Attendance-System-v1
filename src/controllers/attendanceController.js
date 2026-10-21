'use strict';

const { validationResult } = require('express-validator');
const attendanceService = require('../services/attendanceService');
const attendanceRepo = require('../repositories/attendanceRepo');
const attendanceValidator = require('../validators/attendanceValidator');
const eventRepo = require('../repositories/eventRepo');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/errors');
const { parsePagination } = require('../utils/pagination');

function validate(req) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw ApiError.badRequest(errors.array({ onlyFirstError: true })[0].msg);
  }
}

const checkInApi = [
  ...attendanceValidator.submission,
  asyncHandler(async (req, res) => {
    validate(req);
    const result = await attendanceService.checkIn(req.user, req.body, { ip: req.ip });
    res.json({
      ok: true,
      alreadyCheckedIn: result.alreadyCheckedIn,
      attendance: result.attendance,
      event: { id: result.event.id, title: result.event.title, checkoutRequired: !!result.event.checkout_required },
    });
  }),
];

const checkOutApi = [
  ...attendanceValidator.submission,
  asyncHandler(async (req, res) => {
    validate(req);
    const result = await attendanceService.checkOut(req.user, req.body, { ip: req.ip });
    res.json({
      ok: true,
      alreadyCheckedOut: result.alreadyCheckedOut,
      attendance: result.attendance,
      event: { id: result.event.id, title: result.event.title },
    });
  }),
];

const mineApi = asyncHandler(async (req, res) => {
  const { page, limit, offset } = parsePagination(req);
  const { rows, total } = await attendanceRepo.listForStudent(req.user.studentId, { limit, offset });
  res.json({ rows, total, page, limit });
});

async function studentDashboardPage(req, res) {
  const events = await eventRepo.listForStudent(req.user.studentId, { includePast: false });
  const { rows: history } = await attendanceRepo.listForStudent(req.user.studentId, { limit: 5, offset: 0 });
  const settings = await require('../services/settingsService').getPublicConfig();
  res.render('student/dashboard', {
    title: 'My Events',
    events,
    history,
    settings,
    now: new Date(),
  });
}

async function studentEventPage(req, res) {
  const eventId = Number.parseInt(req.params.id, 10);
  const events = await eventRepo.listForStudent(req.user.studentId, { includePast: true, limit: 200 });
  const event = events.find((e) => e.id === eventId);
  if (!event) throw ApiError.notFound('Event not found or you are not eligible for it.');
  const settings = await require('../services/settingsService').getPublicConfig();
  res.render('student/event', { title: event.title, event, settings, now: new Date() });
}

async function studentScanPage(req, res) {
  const eventId = Number.parseInt(req.params.id, 10);
  const events = await eventRepo.listForStudent(req.user.studentId, { includePast: true, limit: 200 });
  const event = events.find((e) => e.id === eventId);
  if (!event) throw ApiError.notFound('Event not found or you are not eligible for it.');
  const settings = await require('../services/settingsService').getPublicConfig();

  const nowTs = Date.now();
  const attendance = await attendanceRepo.findByEventAndStudent(eventId, req.user.studentId);
  const windowOpen =
    event.status === 'published' &&
    nowTs >= new Date(event.checkin_opens_at).getTime() &&
    nowTs <= new Date(event.checkin_closes_at).getTime();
  const checkoutOpen =
    event.status === 'published' && event.checkout_required && nowTs <= new Date(event.end_at).getTime();

  res.render('student/scan', {
    title: `Scan · ${event.title}`,
    event,
    settings,
    windowOpen,
    checkoutOpen,
    attendance,
  });
}

async function studentHistoryPage(req, res) {
  const { page, limit, offset } = parsePagination(req);
  const { rows, total } = await attendanceRepo.listForStudent(req.user.studentId, { limit, offset });
  res.render('student/history', {
    title: 'My Attendance',
    rows,
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
}

// --- Coordinator APIs (admin / assigned teacher) -------------------------------

const reviewApi = [
  ...attendanceValidator.review,
  asyncHandler(async (req, res) => {
    validate(req);
    const result = await attendanceService.review(req.user, Number(req.params.id), req.body.decision, req.body.reason, {
      ip: req.ip,
    });
    res.json({ ok: true, attendance: result.attendance });
  }),
];

const manualEntryApi = [
  ...attendanceValidator.manualEntry,
  asyncHandler(async (req, res) => {
    validate(req);
    const result = await attendanceService.manualEntry(
      req.user,
      {
        eventId: Number(req.params.id),
        studentId: Number(req.body.studentId),
        status: req.body.status,
        reason: req.body.reason,
      },
      { ip: req.ip }
    );
    res.json({ ok: true, attendance: result.attendance });
  }),
];

const manualCheckOutApi = [
  ...attendanceValidator.manualCheckout,
  asyncHandler(async (req, res) => {
    validate(req);
    const result = await attendanceService.manualCheckOut(req.user, Number(req.params.id), req.body.reason, {
      ip: req.ip,
    });
    res.json({ ok: true, attendance: result.attendance });
  }),
];

const correctionApi = [
  ...attendanceValidator.correction,
  asyncHandler(async (req, res) => {
    validate(req);
    const result = await attendanceService.correctStatus(
      req.user,
      Number(req.params.id),
      { status: req.body.status, reason: req.body.reason },
      { ip: req.ip }
    );
    res.json({ ok: true, attendance: result.attendance });
  }),
];

const auditApi = [
  ...attendanceValidator.auditQuery,
  asyncHandler(async (req, res) => {
    validate(req);
    const record = await attendanceRepo.findByIdFull(Number(req.params.id));
    if (!record) throw ApiError.notFound('Attendance record not found.');
    await assertEventAccess(req.user, record.event_id);
    const logs = await attendanceRepo.listAuditForAttendance(record.id);
    res.json({ rows: logs });
  }),
];

async function assertEventAccess(user, eventId) {
  if (user.role === 'admin') return;
  const { teacherAssignedToEvent } = require('../middleware/authorize');
  if (user.role === 'teacher' && (await teacherAssignedToEvent(user.teacherId, eventId))) return;
  throw ApiError.forbidden('You are not allowed to manage attendance for this event.');
}

// --- Management pages -----------------------------------------------------------

/** Shared event attendance console for admins and assigned teachers. */
async function eventManagePage(req, res) {
  const eventId = req.eventAccess.eventId;
  const event = await eventRepo.findById(eventId);
  if (!event) throw ApiError.notFound('Event not found.');
  const [stats, rows, flagged] = await Promise.all([
    attendanceRepo.countByStatusForEvent(eventId),
    attendanceRepo.listForEvent(eventId, { limit: 200, offset: 0 }),
    attendanceRepo.listFlagged({ eventId, limit: 50, offset: 0 }),
  ]);
  res.render('attendance/manage', {
    title: `Attendance · ${event.title}`,
    event,
    stats,
    rows,
    flagged: flagged.rows,
    isAdmin: req.user.role === 'admin',
    backPath: req.user.role === 'admin' ? '/admin/events' : '/teacher/events',
  });
}

/** Cross-event review queue (admins). Teachers review inside their event console. */
async function reviewQueuePage(req, res) {
  const { page, limit, offset } = parsePagination(req, 25);
  const { rows, total } = await attendanceRepo.listFlagged({ eventId: null, limit, offset });
  res.render('attendance/review', {
    title: 'Review Queue',
    rows,
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
}

module.exports = {
  checkInApi,
  checkOutApi,
  mineApi,
  studentDashboardPage,
  studentEventPage,
  studentScanPage,
  studentHistoryPage,
  reviewApi,
  manualEntryApi,
  manualCheckOutApi,
  correctionApi,
  auditApi,
  eventManagePage,
  reviewQueuePage,
};
