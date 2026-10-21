'use strict';

const { validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const studentRepo = require('../repositories/studentRepo');
const userRepo = require('../repositories/userRepo');
const structureRepo = require('../repositories/structureRepo');
const studentService = require('../services/studentService');
const authService = require('../services/authService');
const auditService = require('../services/auditService');
const studentValidator = require('../validators/studentValidator');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/errors');
const { parsePagination } = require('../utils/pagination');

async function createStudentRecord(req, body) {
  const username = (body.username || body.studentNumber).toLowerCase();
  if (await userRepo.usernameExists(username)) {
    throw ApiError.conflict('That username is already taken.');
  }
  if (await studentRepo.getByStudentNumber(body.studentNumber)) {
    throw ApiError.conflict('That student number already exists.');
  }
  const password = body.password || studentService.DEFAULT_STUDENT_PASSWORD;
  authService.validatePasswordStrength(password);
  const passwordHash = await bcrypt.hash(password, 10);

  const conn = await db.getConnection();
  let studentId;
  try {
    await conn.beginTransaction();
    const result = await studentRepo.insertWithUser(conn, {
      user: { username, email: body.email || null, passwordHash },
      student: {
        studentNumber: body.studentNumber,
        firstName: body.firstName,
        middleName: body.middleName || null,
        lastName: body.lastName,
        gradeLevelId: body.gradeLevelId ? Number.parseInt(body.gradeLevelId, 10) : null,
        sectionId: body.sectionId ? Number.parseInt(body.sectionId, 10) : null,
        schoolYearId: body.schoolYearId ? Number.parseInt(body.schoolYearId, 10) : null,
        status: 'active',
      },
    });
    studentId = result.studentId;
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  await auditService.logAdminAction(req, 'student.create', 'student', studentId, {
    studentNumber: body.studentNumber,
  });
  return studentId;
}

async function listPage(req, res) {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = 20;
  const filters = {
    search: req.query.search || '',
    gradeLevelId: req.query.gradeLevelId ? Number.parseInt(req.query.gradeLevelId, 10) : null,
    sectionId: req.query.sectionId ? Number.parseInt(req.query.sectionId, 10) : null,
    status: req.query.status || null,
    sort: req.query.sort || null,
  };
  const [{ rows, total }, grades, sections] = await Promise.all([
    studentRepo.list({ ...filters, limit, offset: (page - 1) * limit }),
    structureRepo.listGradeLevels(),
    structureRepo.listSections({}),
  ]);
  res.render('admin/students', {
    title: 'Students',
    students: rows,
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    grades,
    sections,
    filters,
  });
}

async function formPage(req, res) {
  const student = req.params.id ? await studentRepo.getById(req.params.id) : null;
  if (req.params.id && !student) throw ApiError.notFound('Student not found.');
  const [grades, sections, years] = await Promise.all([
    structureRepo.listGradeLevels(),
    structureRepo.listSections({}),
    structureRepo.listSchoolYears(),
  ]);
  res.render('admin/student_form', {
    title: student ? 'Edit Student' : 'Add Student',
    student,
    grades,
    sections,
    years,
  });
}

const createApi = [
  ...studentValidator.create,
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) throw ApiError.badRequest(errors.array({ onlyFirstError: true })[0].msg);
    const id = await createStudentRecord(req, req.body);
    res.status(201).json({ ok: true, id });
  }),
];

const updateApi = [
  ...studentValidator.idParam ? [studentValidator.idParam] : [],
  asyncHandler(async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const existing = await studentRepo.getById(id);
    if (!existing) throw ApiError.notFound('Student not found.');
    const body = req.body;

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      await studentRepo.update(conn, id, {
        first_name: body.firstName ?? existing.first_name,
        middle_name: body.middleName !== undefined ? body.middleName || null : existing.middle_name,
        last_name: body.lastName ?? existing.last_name,
        grade_level_id: body.gradeLevelId !== undefined ? (body.gradeLevelId ? Number.parseInt(body.gradeLevelId, 10) : null) : existing.grade_level_id,
        section_id: body.sectionId !== undefined ? (body.sectionId ? Number.parseInt(body.sectionId, 10) : null) : existing.section_id,
        school_year_id: body.schoolYearId !== undefined ? (body.schoolYearId ? Number.parseInt(body.schoolYearId, 10) : null) : existing.school_year_id,
        status: body.status ?? existing.status,
      });
      if (body.email !== undefined) {
        await userRepo.updateEmail(existing.user_id, body.email || null, conn);
      }
      if (body.status && ['active', 'inactive'].includes(body.status)) {
        await studentRepo.setUserStatusesForStudents(conn, [id], body.status === 'active' ? 'active' : 'inactive');
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    await auditService.logAdminAction(req, 'student.update', 'student', id, {
      fields: Object.keys(body),
    });
    res.json({ ok: true });
  }),
];

const getByIdApi = asyncHandler(async (req, res) => {
  const student = await studentRepo.getById(Number.parseInt(req.params.id, 10));
  if (!student) throw ApiError.notFound('Student not found.');
  res.json({ student });
});

const historyApi = asyncHandler(async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const { page, limit, offset } = parsePagination(req);
  const { rows, total } = await studentRepo.attendanceHistory(id, { limit, offset });
  res.json({ rows, total, page, limit });
});

const bulkApi = [
  ...studentValidator.bulk,
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) throw ApiError.badRequest(errors.array()[0].msg);
    const actionMap = { activate: 'active', deactivate: 'inactive', archive: 'archived' };
    const status = actionMap[req.body.action];
    const ids = req.body.ids.map((n) => Number.parseInt(n, 10));
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const affected = await studentRepo.setStatus(conn, ids, status);
      await studentRepo.setUserStatusesForStudents(conn, ids, status === 'active' ? 'active' : 'inactive');
      await conn.commit();
      await auditService.logAdminAction(req, `student.bulk_${req.body.action}`, 'student', null, {
        count: affected,
      });
      res.json({ ok: true, affected });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }),
];

async function importPage(req, res) {
  res.render('admin/import', { title: 'Import Students' });
}

const importValidateApi = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('Attach a .csv or .xlsx file.');
  const report = await studentService.validate(req.file.buffer, req.file.originalname);
  res.json(report);
});

const importCommitApi = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('Attach a .csv or .xlsx file.');
  const result = await studentService.commit(req.file.buffer, req.file.originalname, req.user.id);
  res.json({ ok: true, created: result.created, skipped: result.skipped });
});

module.exports = {
  createStudentRecord,
  listPage,
  formPage,
  createApi,
  updateApi,
  getByIdApi,
  historyApi,
  bulkApi,
  importPage,
  importValidateApi,
  importCommitApi,
};
