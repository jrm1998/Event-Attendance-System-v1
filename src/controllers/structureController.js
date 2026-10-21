'use strict';

const { validationResult } = require('express-validator');
const db = require('../config/database');
const structureRepo = require('../repositories/structureRepo');
const structureValidator = require('../validators/structureValidator');
const auditService = require('../services/auditService');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/errors');

async function structurePage(req, res) {
  const [years, grades, sections] = await Promise.all([
    structureRepo.listSchoolYears(),
    structureRepo.listGradeLevels(),
    structureRepo.listSections({}),
  ]);
  res.render('admin/structure', {
    title: 'School Structure',
    years,
    grades,
    sections,
  });
}

async function listApi(req, res) {
  const [years, grades, sections] = await Promise.all([
    structureRepo.listSchoolYears(),
    structureRepo.listGradeLevels(),
    structureRepo.listSections({}),
  ]);
  res.json({ schoolYears: years, gradeLevels: grades, sections });
}

const createYearApi = [
  ...structureValidator.schoolYear,
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) throw ApiError.badRequest(errors.array()[0].msg);
    if (req.body.endDate <= req.body.startDate) {
      throw ApiError.badRequest('End date must be after the start date.');
    }
    try {
      const id = await structureRepo.createSchoolYear(req.body);
      await auditService.logAdminAction(req, 'structure.year_create', 'school_year', id, {
        name: req.body.name,
      });
      res.status(201).json({ ok: true, id });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        throw ApiError.conflict('A school year with that name already exists.');
      }
      throw err;
    }
  }),
];

const activateYearApi = [
  asyncHandler(async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const year = await structureRepo.getSchoolYearById(id);
    if (!year) throw ApiError.notFound('School year not found.');
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      await structureRepo.activateSchoolYear(conn, id);
      await conn.commit();
      await auditService.logAdminAction(req, 'structure.year_activate', 'school_year', id, {
        name: year.name,
      });
      res.json({ ok: true });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }),
];

const updateYearApi = [
  ...structureValidator.schoolYear,
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) throw ApiError.badRequest(errors.array()[0].msg);
    const id = Number.parseInt(req.params.id, 10);
    await structureRepo.updateSchoolYear(id, req.body);
    await auditService.logAdminAction(req, 'structure.year_update', 'school_year', id, {
      name: req.body.name,
      status: req.body.status,
    });
    res.json({ ok: true });
  }),
];

const createGradeApi = [
  ...structureValidator.gradeLevel,
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) throw ApiError.badRequest(errors.array()[0].msg);
    try {
      const id = await structureRepo.createGradeLevel(req.body);
      await auditService.logAdminAction(req, 'structure.grade_create', 'grade_level', id, {
        name: req.body.name,
      });
      res.status(201).json({ ok: true, id });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        throw ApiError.conflict('A grade level with that name already exists.');
      }
      throw err;
    }
  }),
];

const createSectionApi = [
  ...structureValidator.section,
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) throw ApiError.badRequest(errors.array()[0].msg);
    try {
      const id = await structureRepo.createSection(req.body);
      await auditService.logAdminAction(req, 'structure.section_create', 'section', id, {
        name: req.body.name,
      });
      res.status(201).json({ ok: true, id });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        throw ApiError.conflict('That section already exists for this grade level and school year.');
      }
      throw err;
    }
  }),
];

const updateSectionApi = [
  asyncHandler(async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const { name, status } = req.body;
    if (!name && !status) throw ApiError.badRequest('Nothing to update.');
    if (status && !['active', 'archived'].includes(status)) {
      throw ApiError.badRequest('Invalid section status.');
    }
    await structureRepo.updateSection(id, { name, status });
    await auditService.logAdminAction(req, 'structure.section_update', 'section', id, {
      name,
      status,
    });
    res.json({ ok: true });
  }),
];

module.exports = {
  structurePage,
  listApi,
  createYearApi,
  activateYearApi,
  updateYearApi,
  createGradeApi,
  createSectionApi,
  updateSectionApi,
};
