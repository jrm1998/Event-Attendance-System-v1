'use strict';

const db = require('../config/database');

const SORT_COLUMNS = {
  student_number: 's.student_number',
  last_name: 's.last_name',
  grade: 'g.sort_order',
  created_at: 's.created_at',
};

async function list({ search, gradeLevelId, sectionId, status, schoolYearId, sort, limit, offset }) {
  const where = [];
  const params = [];
  if (search) {
    where.push(
      '(s.student_number LIKE ? OR s.first_name LIKE ? OR s.last_name LIKE ? OR u.username LIKE ?)'
    );
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }
  if (gradeLevelId) {
    where.push('s.grade_level_id = ?');
    params.push(gradeLevelId);
  }
  if (sectionId) {
    where.push('s.section_id = ?');
    params.push(sectionId);
  }
  if (status) {
    where.push('s.status = ?');
    params.push(status);
  }
  if (schoolYearId) {
    where.push('s.school_year_id = ?');
    params.push(schoolYearId);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const orderSql = `ORDER BY ${SORT_COLUMNS[sort] || 's.last_name'}, s.first_name`;

  const [countRows] = await db.query(
    `SELECT COUNT(*) AS total FROM students s JOIN users u ON u.id = s.user_id ${whereSql}`,
    params
  );
  const [rows] = await db.query(
    `SELECT s.id, s.user_id, s.student_number, s.first_name, s.middle_name, s.last_name,
            s.grade_level_id, s.section_id, s.school_year_id, s.photo_path, s.status, s.created_at,
            g.name AS grade_level_name, g.sort_order AS grade_sort,
            sec.name AS section_name, u.username, u.email, u.status AS user_status
       FROM students s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN grade_levels g ON g.id = s.grade_level_id
       LEFT JOIN sections sec ON sec.id = s.section_id
       ${whereSql}
       ${orderSql}
       LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return { rows, total: countRows[0].total };
}

async function getById(id) {
  const [rows] = await db.query(
    `SELECT s.*, u.username, u.email, u.status AS user_status,
            g.name AS grade_level_name, sec.name AS section_name, sy.name AS school_year_name
       FROM students s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN grade_levels g ON g.id = s.grade_level_id
       LEFT JOIN sections sec ON sec.id = s.section_id
       LEFT JOIN school_years sy ON sy.id = s.school_year_id
      WHERE s.id = ? LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function getByStudentNumber(studentNumber) {
  const [rows] = await db.query('SELECT * FROM students WHERE student_number = ? LIMIT 1', [
    studentNumber,
  ]);
  return rows[0] || null;
}

async function insertWithUser(conn, { user, student }) {
  const [u] = await conn.query(
    'INSERT INTO users (username, email, password_hash, role, status) VALUES (?, ?, ?, "student", "active")',
    [user.username, user.email, user.passwordHash]
  );
  const [s] = await conn.query(
    `INSERT INTO students
       (user_id, student_number, first_name, middle_name, last_name,
        grade_level_id, section_id, school_year_id, photo_path, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      u.insertId,
      student.studentNumber,
      student.firstName,
      student.middleName || null,
      student.lastName,
      student.gradeLevelId || null,
      student.sectionId || null,
      student.schoolYearId || null,
      student.photoPath || null,
      student.status || 'active',
    ]
  );
  return { userId: u.insertId, studentId: s.insertId };
}

async function update(conn, id, fields) {
  const allowed = [
    'first_name', 'middle_name', 'last_name', 'grade_level_id', 'section_id',
    'school_year_id', 'photo_path', 'status',
  ];
  const sets = [];
  const params = [];
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = ?`);
      params.push(fields[key]);
    }
  }
  if (!sets.length) return;
  params.push(id);
  await conn.query(`UPDATE students SET ${sets.join(', ')} WHERE id = ?`, params);
}

async function setStatus(conn, ids, status) {
  if (!ids.length) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const [result] = await conn.query(
    `UPDATE students SET status = ? WHERE id IN (${placeholders})`,
    [status, ...ids]
  );
  return result.affectedRows;
}

async function setUserStatusesForStudents(conn, studentIds, userStatus) {
  if (!studentIds.length) return 0;
  const placeholders = studentIds.map(() => '?').join(',');
  const [result] = await conn.query(
    `UPDATE users u JOIN students s ON s.user_id = u.id
        SET u.status = ? WHERE s.id IN (${placeholders})`,
    [userStatus, ...studentIds]
  );
  return result.affectedRows;
}

async function existingNumbersOrUsernames(numbers, usernames) {
  const found = { numbers: new Set(), usernames: new Set() };
  if (numbers.length) {
    const placeholders = numbers.map(() => '?').join(',');
    const [rows] = await db.query(
      `SELECT student_number FROM students WHERE student_number IN (${placeholders})`,
      numbers
    );
    rows.forEach((r) => found.numbers.add(r.student_number));
  }
  if (usernames.length) {
    const placeholders = usernames.map(() => '?').join(',');
    const [rows] = await db.query(
      `SELECT username FROM users WHERE username IN (${placeholders})`,
      usernames
    );
    rows.forEach((r) => found.usernames.add(r.username));
  }
  return found;
}

async function countByStatus() {
  const [rows] = await db.query(
    `SELECT status, COUNT(*) AS c FROM students GROUP BY status`
  );
  const out = { active: 0, inactive: 0, archived: 0 };
  rows.forEach((r) => {
    out[r.status] = r.c;
  });
  return out;
}

async function attendanceHistory(studentId, { limit, offset }) {
  const [countRows] = await db.query(
    'SELECT COUNT(*) AS total FROM attendance WHERE student_id = ?',
    [studentId]
  );
  const [rows] = await db.query(
    `SELECT a.*, e.title AS event_title, e.venue_name, e.category
       FROM attendance a JOIN events e ON e.id = a.event_id
      WHERE a.student_id = ?
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT ? OFFSET ?`,
    [studentId, limit, offset]
  );
  return { rows, total: countRows[0].total };
}

/** Maps student ids to their login user ids (for notifications). */
async function getUserIdsForStudents(studentIds) {
  if (!studentIds.length) return [];
  const [rows] = await db.query(
    `SELECT id, user_id FROM students WHERE id IN (${studentIds.map(() => '?').join(',')})`,
    studentIds
  );
  return rows.map((r) => ({ studentId: r.id, userId: r.user_id }));
}

module.exports = {
  list,
  getById,
  getByStudentNumber,
  insertWithUser,
  update,
  setStatus,
  setUserStatusesForStudents,
  existingNumbersOrUsernames,
  countByStatus,
  attendanceHistory,
  getUserIdsForStudents,
};
