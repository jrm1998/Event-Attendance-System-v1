'use strict';

const { validationResult } = require('express-validator');
const eventRepo = require('../repositories/eventRepo');
const attendanceRepo = require('../repositories/attendanceRepo');
const eventService = require('../services/eventService');
const studentRepo = require('../repositories/studentRepo');
const eventValidator = require('../validators/eventValidator');
const uploadService = require('../services/uploadService');
const structureRepo = require('../repositories/structureRepo');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/errors');
const { parsePagination } = require('../utils/pagination');

const posterUpload = uploadService.makeImageUpload('poster', 5);

function handleValidation(req) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw ApiError.badRequest(errors.array({ onlyFirstError: true })[0].msg, {
      details: errors.array({ onlyFirstError: true }),
    });
  }
}

async function withPoster(req) {
  if (!req.file) return undefined;
  try {
    await uploadService.verifyImageMagic(req.file.path);
  } catch (err) {
    uploadService.deleteQuietly(req.file.path);
    throw err;
  }
  return uploadService.publicPath(req.file.filename);
}

async function listPage(req, res) {
  const { page, limit, offset } = parsePagination(req, 25);
  const { rows, total } = await eventRepo.list({
    status: req.query.status || null,
    search: req.query.search || null,
    limit,
    offset,
  });
  res.render('admin/events', {
    title: 'Events',
    events: rows,
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    filters: { status: req.query.status || '', search: req.query.search || '' },
  });
}

function selectedStudentPayload(eligibility) {
  return ((eligibility && eligibility.students) || []).map((s) => ({
    id: s.id,
    studentNumber: s.student_number,
    firstName: s.first_name,
    lastName: s.last_name,
  }));
}

async function newPage(req, res) {
  const [teachers, sections, grades] = await Promise.all([
    eventService.listTeacherOptions(),
    eventService.sectionOptions(),
    structureRepo.listGradeLevels(),
  ]);
  res.render('admin/event_form', {
    title: 'New Event',
    event: null,
    eligibility: null,
    assignments: [],
    teachers,
    sections,
    eligibilityGrades: grades,
    selectedStudents: [],
  });
}

async function editPage(req, res) {
  const { event, eligibility, assignments } = await eventService.getEventForEdit(req.params.id);
  const [teachers, sections, grades] = await Promise.all([
    eventService.listTeacherOptions(),
    eventService.sectionOptions(),
    structureRepo.listGradeLevels(),
  ]);
  res.render('admin/event_form', {
    title: 'Edit Event',
    event,
    eligibility,
    assignments,
    teachers,
    sections,
    eligibilityGrades: grades,
    selectedStudents: selectedStudentPayload(eligibility),
  });
}

const listApi = [
  ...eventValidator.listQuery,
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = parsePagination(req, 25);
    if (req.user.role === 'teacher') {
      const rows = await eventRepo.listForTeacher(req.user.teacherId);
      return res.json({ rows, total: rows.length, page: 1, limit: rows.length });
    }
    const { rows, total } = await eventRepo.list({
      status: req.query.status || null,
      search: req.query.search || null,
      limit,
      offset,
    });
    res.json({ rows, total, page, limit });
  }),
];

const getApi = asyncHandler(async (req, res) => {
  const eventId = Number.parseInt(req.params.id, 10);
  const { event, eligibility, assignments } = await eventService.getEventForEdit(eventId);
  const eligibleCount = await eventRepo.countEligibleStudents(eventId);
  res.json({ event, eligibility, assignments, eligibleCount });
});

const eligibleCountApi = asyncHandler(async (req, res) => {
  const eventId = Number.parseInt(req.params.id, 10);
  res.json({ count: await eventRepo.countEligibleStudents(eventId) });
});

const createApi = [
  posterUpload.single('poster'),
  ...eventValidator.createOrUpdate,
  asyncHandler(async (req, res) => {
    handleValidation(req);
    const posterPath = await withPoster(req);
    if (posterPath) req.body.posterPath = posterPath;
    let id;
    try {
      id = await eventService.createEvent(req.user, req.body, req.ip);
    } catch (err) {
      if (posterPath) uploadService.deleteQuietly(posterPath);
      throw err;
    }
    res.status(201).json({ ok: true, id });
  }),
];

const updateApi = [
  posterUpload.single('poster'),
  ...eventValidator.createOrUpdate,
  asyncHandler(async (req, res) => {
    handleValidation(req);
    const posterPath = await withPoster(req);
    if (posterPath) req.body.posterPath = posterPath;
    try {
      await eventService.updateEvent(req.user, Number.parseInt(req.params.id, 10), req.body, req.ip);
    } catch (err) {
      if (posterPath) uploadService.deleteQuietly(posterPath);
      throw err;
    }
    res.json({ ok: true });
  }),
];

const actionApi = [
  ...eventValidator.action,
  asyncHandler(async (req, res) => {
    const action = req.params.action || req.body.action;
    await eventService.changeStatus(req.user, Number.parseInt(req.params.id, 10), action, req.ip);
    res.json({ ok: true });
  }),
];

const studentsSearchApi = asyncHandler(async (req, res) => {
  const search = String(req.query.q || '').trim();
  if (search.length < 2) return res.json({ rows: [] });
  const { rows } = await studentRepo.list({ search, limit: 10, offset: 0, status: 'active' });
  res.json({
    rows: rows.map((s) => ({
      id: s.id,
      studentNumber: s.student_number,
      firstName: s.first_name,
      lastName: s.last_name,
      gradeLevelName: s.grade_level_name,
      sectionName: s.section_name,
    })),
  });
});

/** Eligible-student search scoped to one event, for manual check-in. */
const eventStudentsSearchApi = [
  eventValidator.idParam,
  asyncHandler(async (req, res) => {
    handleValidation(req);
    const search = String(req.query.q || '').trim();
    if (search.length < 2) return res.json({ rows: [] });
    const rows = await eventRepo.searchEligibleStudents(Number(req.params.id), search, 10);
    res.json({
      rows: rows.map((s) => ({
        id: s.id,
        studentNumber: s.student_number,
        firstName: s.first_name,
        lastName: s.last_name,
        gradeLevelName: s.grade_level_name,
        sectionName: s.section_name,
      })),
    });
  }),
];

/** Attendance rows for one event (manage screen / live refresh). */
const attendanceListApi = [
  eventValidator.idParam,
  asyncHandler(async (req, res) => {
    handleValidation(req);
    const eventId = Number(req.params.id);
    const status = ['present', 'late', 'checked_out', 'absent', 'pending_review', 'rejected'].includes(req.query.status)
      ? req.query.status
      : null;
    const { page, limit, offset } = parsePagination(req, 50);
    const rows = await attendanceRepo.listForEvent(eventId, { status, limit, offset });
    const total = await attendanceRepo.countForEvent(eventId, { status });
    res.json({ rows, total, page, limit });
  }),
];

module.exports = {
  listPage,
  newPage,
  editPage,
  listApi,
  getApi,
  eligibleCountApi,
  createApi,
  updateApi,
  actionApi,
  studentsSearchApi,
  eventStudentsSearchApi,
  attendanceListApi,
};
