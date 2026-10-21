'use strict';

const db = require('../config/database');

async function findCredentialsByUsername(username) {
  const [rows] = await db.query(
    `SELECT id, username, email, password_hash, role, status
       FROM users WHERE username = ? LIMIT 1`,
    [username]
  );
  return rows[0] || null;
}

async function getDetailsById(userId) {
  const [rows] = await db.query(
    `SELECT u.id, u.username, u.email, u.role, u.status, u.created_at, u.last_login_at,
            s.id AS student_id, s.first_name AS s_first_name, s.last_name AS s_last_name,
            s.student_number, s.section_id, s.grade_level_id, s.school_year_id, s.status AS student_status,
            t.id AS teacher_id, t.first_name AS t_first_name, t.last_name AS t_last_name,
            t.status AS teacher_status
       FROM users u
       LEFT JOIN students s ON s.user_id = u.id
       LEFT JOIN teachers t ON t.user_id = u.id
      WHERE u.id = ? LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

async function updateLastLogin(userId, when) {
  await db.query('UPDATE users SET last_login_at = ? WHERE id = ?', [when, userId]);
}

async function updatePassword(userId, passwordHash) {
  await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, userId]);
}

async function updateStatus(userId, status) {
  await db.query('UPDATE users SET status = ? WHERE id = ?', [status, userId]);
}

async function updateEmail(userId, email, conn = db) {
  await conn.query('UPDATE users SET email = ? WHERE id = ?', [email, userId]);
}

async function listUsers({ role, status, search, limit, offset }) {
  const where = [];
  const params = [];
  if (role) {
    where.push('u.role = ?');
    params.push(role);
  }
  if (status) {
    where.push('u.status = ?');
    params.push(status);
  }
  if (search) {
    where.push('(u.username LIKE ? OR u.email LIKE ? OR CONCAT(COALESCE(s.first_name,""), " ", COALESCE(s.last_name,"")) LIKE ? OR CONCAT(COALESCE(t.first_name,""), " ", COALESCE(t.last_name,"")) LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [countRows] = await db.query(
    `SELECT COUNT(*) AS total FROM users u
       LEFT JOIN students s ON s.user_id = u.id
       LEFT JOIN teachers t ON t.user_id = u.id
       ${whereSql}`,
    params
  );
  const [rows] = await db.query(
    `SELECT u.id, u.username, u.email, u.role, u.status, u.last_login_at, u.created_at,
            CONCAT(COALESCE(s.first_name, t.first_name, ''), ' ', COALESCE(s.last_name, t.last_name, '')) AS full_name,
            s.student_number, s.status AS student_status, t.status AS teacher_status
       FROM users u
       LEFT JOIN students s ON s.user_id = u.id
       LEFT JOIN teachers t ON t.user_id = u.id
       ${whereSql}
       ORDER BY u.created_at DESC, u.id DESC
       LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return { rows, total: countRows[0].total };
}

async function usernameExists(username, excludeId = null) {
  const [rows] = await db.query(
    'SELECT id FROM users WHERE username = ? AND (? IS NULL OR id <> ?) LIMIT 1',
    [username, excludeId, excludeId]
  );
  return rows.length > 0;
}

async function createUser({ username, email, passwordHash, role }, conn = db) {
  const [result] = await conn.query(
    'INSERT INTO users (username, email, password_hash, role, status) VALUES (?, ?, ?, ?, "active")',
    [username, email, passwordHash, role]
  );
  return result.insertId;
}

module.exports = {
  findCredentialsByUsername,
  getDetailsById,
  updateLastLogin,
  updatePassword,
  updateStatus,
  updateEmail,
  listUsers,
  usernameExists,
  createUser,
};
