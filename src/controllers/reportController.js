'use strict';

const auditRepo = require('../repositories/auditRepo');
const eventRepo = require('../repositories/eventRepo');
const { asyncHandler } = require('../utils/asyncHandler');
const { parsePagination } = require('../utils/pagination');

/** General audit trail (admins). */
const auditPage = asyncHandler(async (req, res) => {
  const { page, limit, offset } = parsePagination(req, 30);
  const { rows, total } = await auditRepo.list({
    action: (req.query.action || '').trim() || null,
    search: (req.query.search || '').trim() || null,
    limit,
    offset,
  });
  res.render('admin/audit', {
    title: 'Audit Log',
    rows,
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    filters: { action: req.query.action || '', search: req.query.search || '' },
  });
});

/** Export hub: all events (admins). */
const adminReportsPage = asyncHandler(async (req, res) => {
  const { rows } = await eventRepo.list({ status: null, search: null, limit: 200, offset: 0 });
  res.render('reports/hub', {
    title: 'Reports',
    events: rows,
    basePath: '/api/events',
  });
});

/** Export hub: assigned events (teachers). */
const teacherReportsPage = asyncHandler(async (req, res) => {
  const events = await eventRepo.listForTeacher(req.user.teacherId);
  res.render('reports/hub', {
    title: 'Reports',
    events,
    basePath: '/api/events',
  });
});

/** Manual check-in hub: assigned events linking to their attendance consoles. */
const teacherManualPage = asyncHandler(async (req, res) => {
  const events = await eventRepo.listForTeacher(req.user.teacherId);
  res.render('teacher/manual', { title: 'Manual Check-in', events });
});

module.exports = { auditPage, adminReportsPage, teacherReportsPage, teacherManualPage };
