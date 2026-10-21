'use strict';

const db = require('../config/database');

// --- School years -----------------------------------------------------------

async function listSchoolYears() {
  const [rows] = await db.query(
    'SELECT * FROM school_years ORDER BY start_date DESC, name DESC'
  );
  return rows;
}

async function createSchoolYear({ name, startDate, endDate, status }) {
  const [result] = await db.query(
    'INSERT INTO school_years (name, start_date, end_date, status) VALUES (?, ?, ?, ?)',
    [name, startDate, endDate, status || 'upcoming']
  );
  return result.insertId;
}

async function updateSchoolYear(id, { name, startDate, endDate, status }) {
  await db.query(
    'UPDATE school_years SET name = ?, start_date = ?, end_date = ?, status = ? WHERE id = ?',
    [name, startDate, endDate, status, id]
  );
}

/** Activating a year demotes all other years from 'active' to 'closed'. */
async function activateSchoolYear(conn, id) {
  await conn.query(
    "UPDATE school_years SET status = 'closed' WHERE status = 'active' AND id <> ?",
    [id]
  );
  await conn.query("UPDATE school_years SET status = 'active' WHERE id = ?", [id]);
}

async function getActiveSchoolYear() {
  const [rows] = await db.query("SELECT * FROM school_years WHERE status = 'active' LIMIT 1");
  return rows[0] || null;
}

// --- Grade levels -----------------------------------------------------------

async function listGradeLevels() {
  const [rows] = await db.query('SELECT * FROM grade_levels ORDER BY sort_order, name');
  return rows;
}

async function createGradeLevel({ name, sortOrder }) {
  const [result] = await db.query(
    'INSERT INTO grade_levels (name, sort_order) VALUES (?, ?)',
    [name, sortOrder || 0]
  );
  return result.insertId;
}

// --- Sections ---------------------------------------------------------------

async function listSections({ gradeLevelId, schoolYearId, status } = {}) {
  const where = [];
  const params = [];
  if (gradeLevelId) {
    where.push('sec.grade_level_id = ?');
    params.push(gradeLevelId);
  }
  if (schoolYearId) {
    where.push('sec.school_year_id = ?');
    params.push(schoolYearId);
  }
  if (status) {
    where.push('sec.status = ?');
    params.push(status);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await db.query(
    `SELECT sec.*, g.name AS grade_level_name, sy.name AS school_year_name
       FROM sections sec
       JOIN grade_levels g ON g.id = sec.grade_level_id
       JOIN school_years sy ON sy.id = sec.school_year_id
       ${whereSql}
       ORDER BY g.sort_order, sec.name`,
    params
  );
  return rows;
}

async function createSection({ gradeLevelId, schoolYearId, name }) {
  const [result] = await db.query(
    'INSERT INTO sections (grade_level_id, school_year_id, name, status) VALUES (?, ?, ?, "active")',
    [gradeLevelId, schoolYearId, name]
  );
  return result.insertId;
}

async function updateSection(id, { name, status }) {
  const sets = [];
  const params = [];
  if (name !== undefined) {
    sets.push('name = ?');
    params.push(name);
  }
  if (status !== undefined) {
    sets.push('status = ?');
    params.push(status);
  }
  if (!sets.length) return;
  params.push(id);
  await db.query(`UPDATE sections SET ${sets.join(', ')} WHERE id = ?`, params);
}

async function getSectionById(id) {
  const [rows] = await db.query('SELECT * FROM sections WHERE id = ? LIMIT 1', [id]);
  return rows[0] || null;
}

async function getGradeLevelById(id) {
  const [rows] = await db.query('SELECT * FROM grade_levels WHERE id = ? LIMIT 1', [id]);
  return rows[0] || null;
}

async function getSchoolYearById(id) {
  const [rows] = await db.query('SELECT * FROM school_years WHERE id = ? LIMIT 1', [id]);
  return rows[0] || null;
}

module.exports = {
  listSchoolYears,
  createSchoolYear,
  updateSchoolYear,
  activateSchoolYear,
  getActiveSchoolYear,
  listGradeLevels,
  createGradeLevel,
  listSections,
  createSection,
  updateSection,
  getSectionById,
  getGradeLevelById,
  getSchoolYearById,
};
