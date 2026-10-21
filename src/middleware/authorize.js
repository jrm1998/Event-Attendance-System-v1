'use strict';

const db = require('../config/database');
const { ApiError } = require('../utils/errors');
const { asyncHandler } = require('../utils/asyncHandler');

function isApi(req) {
  // req.path is mount-relative inside mounted routers (Express strips the
  // mount point), so /api/auth/login handlers would see "/auth/login".
  // originalUrl always carries the full path.
  return (req.originalUrl || req.path).startsWith('/api/');
}

/** Restricts a route to the given roles. Backend-enforced RBAC. */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(ApiError.forbidden('This area requires one of the following roles: ' + roles.join(', ') + '.'));
    }
    next();
  };
}

/**
 * Returns true if the teacher is assigned to the event (event_assignments).
 * Admins always pass. `teacherId` may be null for admins.
 */
async function teacherAssignedToEvent(teacherId, eventId) {
  const [rows] = await db.query(
    'SELECT 1 FROM event_assignments WHERE event_id = ? AND teacher_id = ? LIMIT 1',
    [eventId, teacherId]
  );
  return rows.length > 0;
}

/**
 * Middleware: allows admins, or teachers assigned to req.params.eventId /
 * :id. Adds req.eventAccess = { canReview: true, canManual: true }.
 */
function requireEventAccess(paramName = 'id') {
  return asyncHandler(async (req, res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    const eventId = Number.parseInt(req.params[paramName], 10);
    if (!Number.isInteger(eventId)) return next(ApiError.badRequest('Invalid event id.'));
    if (req.user.role === 'admin') {
      req.eventAccess = { eventId, assigned: false };
      return next();
    }
    if (req.user.role !== 'teacher') {
      return next(ApiError.forbidden('Students cannot access this resource.'));
    }
    const assigned = await teacherAssignedToEvent(req.user.teacherId, eventId);
    if (!assigned) {
      return next(ApiError.forbidden('You are not assigned to this event.'));
    }
    req.eventAccess = { eventId, assigned: true };
    next();
  });
}

module.exports = { requireRole, requireEventAccess, teacherAssignedToEvent, isApi };
