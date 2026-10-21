'use strict';

const db = require('../config/database');
const eventRepo = require('../repositories/eventRepo');
const structureRepo = require('../repositories/structureRepo');
const auditRepo = require('../repositories/auditRepo');
const timeUtils = require('../utils/time');
const { ApiError } = require('../utils/errors');

function parseDate(value, label) {
  if (!value) throw ApiError.badRequest(`${label} is required.`);
  // Form fields carry school-local wall time; storing them as server-local
  // would shift every schedule whenever the server runs in another timezone.
  const d = timeUtils.parseSchoolLocal(value);
  if (Number.isNaN(d.getTime())) throw ApiError.badRequest(`${label} is not a valid date/time.`);
  return d;
}

/** Server-side validation of the event schedule and geometry. */
function validateEventFields(data) {
  const startAt = parseDate(data.startAt, 'Event start');
  const endAt = parseDate(data.endAt, 'Event end');
  const checkinOpensAt = parseDate(data.checkinOpensAt, 'Check-in opening');
  const checkinClosesAt = parseDate(data.checkinClosesAt, 'Check-in closing');
  let lateAfter = data.lateAfter ? parseDate(data.lateAfter, 'Late cutoff') : null;

  if (endAt <= startAt) throw ApiError.badRequest('Event end must be after the start.');
  if (checkinClosesAt > endAt) throw ApiError.badRequest('Check-in must close before or when the event ends.');
  if (checkinOpensAt >= checkinClosesAt) {
    throw ApiError.badRequest('Check-in opening must be before check-in closing.');
  }
  if (lateAfter) {
    if (lateAfter < startAt || lateAfter > checkinClosesAt) {
      throw ApiError.badRequest('Late cutoff must fall between event start and check-in closing.');
    }
  } else {
    lateAfter = startAt; // default: arrivals after official start are late
  }
  if (!(data.latitude >= -90 && data.latitude <= 90)) throw ApiError.badRequest('Latitude must be between -90 and 90.');
  if (!(data.longitude >= -180 && data.longitude <= 180)) throw ApiError.badRequest('Longitude must be between -180 and 180.');
  if (!(data.radiusMeters >= 10 && data.radiusMeters <= 10000)) {
    throw ApiError.badRequest('Permitted radius must be 10-10000 meters.');
  }
  if (!(data.maxGpsAccuracyMeters >= 5 && data.maxGpsAccuracyMeters <= 1000)) {
    throw ApiError.badRequest('Maximum GPS accuracy must be 5-1000 meters.');
  }
  return { startAt, endAt, checkinOpensAt, checkinClosesAt, lateAfter };
}

function normalizePayload(body) {
  const intOr = (v, fallback = null) => {
    if (v === undefined || v === null || v === '') return fallback;
    const n = Number.parseInt(v, 10);
    return Number.isNaN(n) ? fallback : n;
  };
  const arr = (v) => {
    const raw = Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v];
    const ids = raw.map((x) => Number.parseInt(x, 10)).filter(Number.isInteger);
    return [...new Set(ids)];
  };
  return {
    title: String(body.title || '').trim(),
    description: String(body.description || '').trim() || null,
    category: String(body.category || '').trim() || null,
    posterPath: body.posterPath || null,
    venueName: String(body.venueName || '').trim(),
    latitude: Number.parseFloat(body.latitude),
    longitude: Number.parseFloat(body.longitude),
    radiusMeters: intOr(body.radiusMeters, 50),
    maxGpsAccuracyMeters: intOr(body.maxGpsAccuracyMeters, 50),
    startAt: body.startAt,
    endAt: body.endAt,
    checkinOpensAt: body.checkinOpensAt,
    checkinClosesAt: body.checkinClosesAt,
    lateAfter: body.lateAfter || null,
    checkoutRequired: body.checkoutRequired === true || body.checkoutRequired === 'true' || body.checkoutRequired === 'on' || body.checkoutRequired === 1,
    maxAttendance: intOr(body.maxAttendance, null),
    gradeIds: arr(body.eligibleGradeIds),
    sectionIds: arr(body.eligibleSectionIds),
    studentIds: arr(body.eligibleStudentIds),
    teacherIds: arr(body.teacherIds),
  };
}

async function createEvent(actor, payloadBody, ipAddress) {
  const data = normalizePayload(payloadBody);
  const times = validateEventFields(data);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const eventId = await eventRepo.create(conn, {
      ...data,
      ...times,
      status: 'draft',
      createdBy: actor.id,
    });
    await applyRelations(conn, eventId, data, actor.id);
    await conn.commit();
    await auditRepo.log({
      actorUserId: actor.id,
      action: 'event.create',
      entityType: 'event',
      entityId: eventId,
      details: { title: data.title },
      ipAddress,
    });
    return eventId;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function updateEvent(actor, eventId, payloadBody, ipAddress) {
  const existing = await eventRepo.findById(eventId);
  if (!existing) throw ApiError.notFound('Event not found.');
  if (['completed', 'cancelled', 'archived'].includes(existing.status)) {
    throw ApiError.badRequest(`A ${existing.status} event can no longer be edited.`);
  }
  const data = normalizePayload(payloadBody);
  const times = validateEventFields(data);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await eventRepo.update(conn, eventId, { ...data, ...times });
    await applyRelations(conn, eventId, data, actor.id);
    await conn.commit();
    await auditRepo.log({
      actorUserId: actor.id,
      action: 'event.update',
      entityType: 'event',
      entityId: eventId,
      details: { title: data.title },
      ipAddress,
    });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function applyRelations(conn, eventId, data, actorId) {
  await eventRepo.setEligibility(conn, eventId, {
    gradeIds: data.gradeIds,
    sectionIds: data.sectionIds,
    studentIds: data.studentIds,
  });
  // The event form replaces the full assignment list, so an empty selection
  // must clear previous assignments (previously impossible to remove a teacher).
  let validIds = [];
  if (data.teacherIds.length) {
    const placeholders = data.teacherIds.map(() => '?').join(',');
    const [rows] = await conn.query(
      `SELECT id FROM teachers WHERE id IN (${placeholders}) AND status = 'active'`,
      data.teacherIds
    );
    validIds = rows.map((r) => r.id);
  }
  await eventRepo.setAssignments(conn, eventId, validIds, actorId);
}

async function changeStatus(actor, eventId, action, ipAddress) {
  const event = await eventRepo.findById(eventId);
  if (!event) throw ApiError.notFound('Event not found.');
  const transitions = {
    publish: { from: ['draft'], to: 'published' },
    cancel: { from: ['draft', 'published'], to: 'cancelled' },
    complete: { from: ['published'], to: 'completed' },
    archive: { from: ['draft', 'published', 'completed', 'cancelled'], to: 'archived' },
  };
  const t = transitions[action];
  if (!t) throw ApiError.badRequest('Unknown event action.');
  if (!t.from.includes(event.status)) {
    throw ApiError.badRequest(`Cannot ${action} an event that is ${event.status}.`);
  }
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await eventRepo.setStatus(conn, eventId, t.to);
    await conn.commit();
    await auditRepo.log({
      actorUserId: actor.id,
      action: `event.${action}`,
      entityType: 'event',
      entityId: eventId,
      details: { from: event.status, to: t.to },
      ipAddress,
    });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function getEventForEdit(eventId) {
  const event = await eventRepo.findById(eventId);
  if (!event) throw ApiError.notFound('Event not found.');
  const [eligibility, assignments] = await Promise.all([
    eventRepo.getEligibility(eventId),
    eventRepo.getAssignments(eventId),
  ]);
  return { event, eligibility, assignments };
}

async function resolveEligibleStudents(eventId) {
  return eventRepo.countEligibleStudents(eventId);
}

async function listTeacherOptions() {
  const [rows] = await db.query(
    `SELECT t.id, t.first_name, t.last_name, t.employee_number
       FROM teachers t JOIN users u ON u.id = t.user_id
      WHERE t.status = 'active' AND u.status = 'active'
      ORDER BY t.last_name, t.first_name`
  );
  return rows;
}

async function sectionOptions() {
  return structureRepo.listSections({ status: 'active' });
}

module.exports = {
  createEvent,
  updateEvent,
  changeStatus,
  getEventForEdit,
  resolveEligibleStudents,
  listTeacherOptions,
  sectionOptions,
  normalizePayload,
  validateEventFields,
};
