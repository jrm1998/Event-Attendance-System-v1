'use strict';

/**
 * CSV / Excel student import with validation and duplicate detection.
 * Two-phase: validate() produces a row-level report; commit() re-parses the
 * SAME file server-side (client never supplies row data) and inserts.
 *
 * Accepted columns (header row, case/space insensitive):
 *   student_number*, first_name*, middle_name, last_name*, email,
 *   grade_level, section, username, password
 *   (* required). grade_level/section matched by name against active year.
 */
const ExcelJS = require('exceljs');
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const studentRepo = require('../repositories/studentRepo');
const structureRepo = require('../repositories/structureRepo');
const auditRepo = require('../repositories/auditRepo');
const authService = require('./authService');
const { ApiError } = require('../utils/errors');
const logger = require('../utils/logger');

const DEFAULT_STUDENT_PASSWORD = 'Student@123';
const MAX_IMPORT_ROWS = 2000;

function normalizeKey(key) {
  return String(key || '').trim().toLowerCase().replace(/\s+/g, '_');
}

function parseCsv(buffer) {
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

async function parseXlsx(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw ApiError.badRequest('The Excel file has no worksheets.');
  const rows = [];
  sheet.eachRow((row) => {
    const values = [];
    row.eachCell({ includeEmpty: true }, (cell) => {
      let value = cell.value;
      if (value && typeof value === 'object' && 'text' in value) value = value.text;
      if (value && typeof value === 'object' && 'result' in value) value = value.result;
      if (value instanceof Date) value = value.toISOString().slice(0, 10);
      values.push(value === null || value === undefined ? '' : String(value));
    });
    rows.push(values);
  });
  return rows;
}

async function parseFile(buffer, filename) {
  const ext = (filename.match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase();
  if (ext === '.xlsx') return parseXlsx(buffer);
  return parseCsv(buffer);
}

function buildRecords(rows) {
  if (!rows.length) throw ApiError.badRequest('The file is empty.');
  if (rows.length - 1 > MAX_IMPORT_ROWS) {
    throw ApiError.badRequest(`Imports are limited to ${MAX_IMPORT_ROWS} data rows per file.`);
  }
  const header = rows[0].map(normalizeKey);
  const required = ['student_number', 'first_name', 'last_name'];
  const missing = required.filter((c) => !header.includes(c));
  if (missing.length) {
    throw ApiError.badRequest(`Missing required column(s): ${missing.join(', ')}.`);
  }
  const idx = (name) => header.indexOf(name);
  const records = [];
  for (let i = 1; i < rows.length; i += 1) {
    const cells = rows[i];
    const get = (name) => {
      const j = idx(name);
      return j >= 0 && j < cells.length ? String(cells[j] || '').trim() : '';
    };
    records.push({
      line: i + 1,
      studentNumber: get('student_number'),
      firstName: get('first_name'),
      middleName: get('middle_name'),
      lastName: get('last_name'),
      email: get('email'),
      gradeLevel: get('grade_level'),
      section: get('section'),
      username: get('username'),
      password: get('password'),
    });
  }
  return records;
}

async function resolveLookups() {
  const [grades, sections, activeYear] = await Promise.all([
    structureRepo.listGradeLevels(),
    structureRepo.listSections({ status: 'active' }),
    structureRepo.getActiveSchoolYear(),
  ]);
  const gradeByName = new Map(grades.map((g) => [g.name.toLowerCase(), g]));
  const sectionByKey = new Map(
    sections.map((s) => [`${s.grade_level_id}::${s.name.toLowerCase()}`, s])
  );
  const sectionByNameOnly = new Map(sections.map((s) => [s.name.toLowerCase(), s]));
  return { gradeByName, sectionByKey, sectionByNameOnly, activeYear };
}

/** Returns per-row validation report (does not write anything). */
async function validate(buffer, filename) {
  const records = buildRecords(await parseFile(buffer, filename));
  const { gradeByName, sectionByKey, sectionByNameOnly, activeYear } = await resolveLookups();

  const seenNumbers = new Set();
  const seenUsernames = new Set();
  const rows = [];
  for (const rec of records) {
    const errors = [];
    if (!/^[A-Za-z0-9-]{3,30}$/.test(rec.studentNumber)) {
      errors.push('student_number must be 3-30 chars (letters, digits, hyphen).');
    }
    if (seenNumbers.has(rec.studentNumber)) errors.push('Duplicate student_number within the file.');
    seenNumbers.add(rec.studentNumber);
    if (!rec.firstName || rec.firstName.length > 80) errors.push('first_name is required (max 80 chars).');
    if (!rec.lastName || rec.lastName.length > 80) errors.push('last_name is required (max 80 chars).');
    if (rec.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rec.email)) errors.push('email is not valid.');
    if (rec.username && !/^[a-zA-Z0-9._-]{3,50}$/.test(rec.username)) {
      errors.push('username must be 3-50 chars (letters, digits, dot, underscore, hyphen).');
    } else if (rec.username && seenUsernames.has(rec.username)) {
      errors.push('Duplicate username within the file.');
    } else if (rec.username) {
      seenUsernames.add(rec.username);
    }
    if (rec.password) {
      try {
        authService.validatePasswordStrength(rec.password);
      } catch (err) {
        errors.push(err.message);
      }
    }

    let gradeId = null;
    if (rec.gradeLevel) {
      const grade = gradeByName.get(rec.gradeLevel.toLowerCase());
      if (!grade) errors.push(`grade_level "${rec.gradeLevel}" not found.`);
      else gradeId = grade.id;
    }
    let sectionId = null;
    if (rec.section) {
      const key = gradeId ? `${gradeId}::${rec.section.toLowerCase()}` : null;
      const section = (key && sectionByKey.get(key)) || sectionByNameOnly.get(rec.section.toLowerCase());
      if (!section) errors.push(`section "${rec.section}" not found${gradeId ? ' for that grade level' : ''}.`);
      else sectionId = section.id;
    }
    if (!activeYear) errors.push('No active school year exists; create one first.');

    rows.push({ line: rec.line, data: { ...rec, gradeId, sectionId }, errors });
  }

  const existing = await studentRepo.existingNumbersOrUsernames(
    rows.map((r) => r.data.studentNumber),
    rows.filter((r) => r.data.username).map((r) => r.data.username)
  );
  for (const row of rows) {
    if (existing.numbers.has(row.data.studentNumber)) {
      row.errors.push(`student_number ${row.data.studentNumber} already exists.`);
    }
    if (row.data.username && existing.usernames.has(row.data.username)) {
      row.errors.push(`username ${row.data.username} already exists.`);
    }
  }

  const validCount = rows.filter((r) => r.errors.length === 0).length;
  return {
    totalRows: rows.length,
    validCount,
    errorCount: rows.length - validCount,
    rows: rows.map((r) => ({ line: r.line, errors: r.errors, sample: `${r.data.studentNumber} — ${r.data.firstName} ${r.data.lastName}` })),
  };
}

async function commit(buffer, filename, actorId) {
  const report = await validate(buffer, filename);
  const validLines = new Set(report.rows.filter((r) => r.errors.length === 0).map((r) => r.line));

  const records = buildRecords(await parseFile(buffer, filename));
  const insertable = records.filter((r) => validLines.has(r.line));
  const activeYear = await structureRepo.getActiveSchoolYear();
  const conn = await db.getConnection();
  const hashCache = new Map();
  let created = 0;
  try {
    await conn.beginTransaction();
    for (const rec of insertable) {
      const username = rec.username || rec.studentNumber.toLowerCase();
      const password = rec.password || DEFAULT_STUDENT_PASSWORD;
      authService.validatePasswordStrength(password);
      // Most rows share the default password; hash each distinct value once.
      let passwordHash = hashCache.get(password);
      if (!passwordHash) {
        passwordHash = await bcrypt.hash(password, 10);
        hashCache.set(password, passwordHash);
      }
      await studentRepo.insertWithUser(conn, {
        user: { username, email: rec.email || null, passwordHash },
        student: {
          studentNumber: rec.studentNumber,
          firstName: rec.firstName,
          middleName: rec.middleName || null,
          lastName: rec.lastName,
          gradeLevelId: rec.gradeId,
          sectionId: rec.sectionId,
          schoolYearId: activeYear ? activeYear.id : null,
          status: 'active',
        },
      });
      created += 1;
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    logger.error('import commit failed:', err);
    throw ApiError.badRequest(`Import failed: ${err.message}. No rows were inserted.`);
  } finally {
    conn.release();
  }

  await auditRepo.log({
    actorUserId: actorId,
    action: 'students.import',
    entityType: 'student',
    details: { created, skipped: report.errorCount, filename },
  });

  return { created, skipped: report.errorCount, report };
}

module.exports = { validate, commit, DEFAULT_STUDENT_PASSWORD };
