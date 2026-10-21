'use strict';

const db = require('../config/database');
const { ApiError } = require('../utils/errors');

/**
 * Loads the session user fresh from the database on every request so role
 * and account-status changes take effect immediately. Attaches req.user:
 * { id, username, email, role, studentId?, teacherId?, fullName?, ... }
 */
async function loadUser(userId) {
  const [rows] = await db.query(
    `SELECT u.id, u.username, u.email, u.role, u.status, u.last_login_at,
            s.id AS student_id, s.first_name AS s_first_name, s.last_name AS s_last_name,
            s.student_number, s.section_id, s.grade_level_id, s.school_year_id, s.status AS student_status,
            t.id AS teacher_id, t.first_name AS t_first_name, t.last_name AS t_last_name,
            t.status AS teacher_status
       FROM users u
       LEFT JOIN students s ON s.user_id = u.id
       LEFT JOIN teachers t ON t.user_id = u.id
      WHERE u.id = ?
      LIMIT 1`,
    [userId]
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: r.id,
    username: r.username,
    email: r.email,
    role: r.role,
    status: r.status,
    studentId: r.student_id || null,
    teacherId: r.teacher_id || null,
    studentNumber: r.student_number || null,
    sectionId: r.section_id || null,
    gradeLevelId: r.grade_level_id || null,
    schoolYearId: r.school_year_id || null,
    fullName:
      r.role === 'student'
        ? `${r.s_first_name} ${r.s_last_name}`
        : r.role === 'teacher'
          ? `${r.t_first_name} ${r.t_last_name}`
          : r.username,
    firstName: r.role === 'student' ? r.s_first_name : r.role === 'teacher' ? r.t_first_name : null,
  };
}

function wantsJson(req) {
  // req.path is mount-relative inside routers; originalUrl keeps the /api prefix.
  return (
    (req.originalUrl || req.path).startsWith('/api/') ||
    req.xhr ||
    req.accepts(['html', 'json']) === 'json'
  );
}

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    if (wantsJson(req)) {
      return next(ApiError.unauthorized('Please log in to continue.'));
    }
    return res.redirect('/login');
  }
  // attachUser already loaded and validated the account earlier in the chain.
  if (req.user) return next();
  // eslint-disable-next-line consistent-return
  loadUser(req.session.userId)
    .then((user) => {
      if (!user || user.status !== 'active') {
        req.session.destroy(() => {});
        if (wantsJson(req)) {
          return next(ApiError.unauthorized('Account is no longer active.'));
        }
        return res.redirect('/login');
      }
      req.user = user;
      next();
    })
    .catch(next);
}

/** Optional variant: attaches req.user when a session exists, never blocks. */
function attachUser(req, res, next) {
  if (!req.session.userId) return next();
  loadUser(req.session.userId)
    .then((user) => {
      if (user && user.status === 'active') req.user = user;
      next();
    })
    .catch(() => next());
}

module.exports = { requireAuth, attachUser, loadUser };
