'use strict';

const db = require('../config/database');
const eventRepo = require('../repositories/eventRepo');
const attendanceRepo = require('../repositories/attendanceRepo');
const studentRepo = require('../repositories/studentRepo');
const qrService = require('./qrService');
const gpsService = require('./gpsService');
const settingsService = require('./settingsService');
const notificationService = require('./notificationService');
const sockets = require('../sockets');
const { teacherAssignedToEvent } = require('../middleware/authorize');
const { ApiError } = require('../utils/errors');
const logger = require('../utils/logger');

function now() {
  return new Date();
}

async function broadcastEventStats(eventId) {
  try {
    const stats = await attendanceRepo.countByStatusForEvent(eventId);
    const recent = await attendanceRepo.listForEvent(eventId, { limit: 5, offset: 0 });
    sockets.emitToEvent(eventId, 'attendance:update', {
      eventId,
      stats,
      recent: recent.map((r) => ({
        id: r.id,
        name: `${r.first_name} ${r.last_name}`,
        studentNumber: r.student_number,
        status: r.status,
        checkinAt: r.checkin_at,
        sectionName: r.section_name,
      })),
    });
  } catch (err) {
    logger.error('broadcastEventStats failed:', err.message);
  }
}

async function logAttempt(conn, data) {
  await attendanceRepo.insertVerificationLog(conn, data);
}

/**
 * Full check-in pipeline. Idempotent: if the student already has a check-in
 * row for the event, the existing record is returned instead of erroring.
 */
async function checkIn(user, body, meta = {}) {
  const parsed = qrService.parsePayload(body.qr);
  const eventId = parsed.eventId;
  const studentId = user.studentId;

  const existing = await attendanceRepo.findByEventAndStudent(eventId, studentId);
  if (existing && existing.checkin_at) {
    return {
      alreadyCheckedIn: true,
      attendance: publicAttendance(existing),
      event: await eventRepo.findById(eventId),
    };
  }

  await qrService.validateScannedPayload(body.qr);

  const event = await eventRepo.findById(eventId);
  if (!event || event.status !== 'published') {
    throw ApiError.badRequest('This event is not open for attendance right now.');
  }
  const ts = now();
  if (ts < new Date(event.checkin_opens_at) || ts > new Date(event.checkin_closes_at)) {
    throw ApiError.badRequest(
      `Check-in for "${event.title}" is closed. It was open from ` +
        `${event.checkin_opens_at} to ${event.checkin_closes_at} (UTC).`
    );
  }

  const eligible = await eventRepo.isStudentEligible(eventId, studentId);
  if (!eligible) {
    await logFailed(eventId, studentId, 'checkin', 'Student is not eligible for this event', parsed.token, body, meta);
    throw ApiError.forbidden('You are not on the eligible list for this event.');
  }

  const gpsConfig = await settingsService.getGpsConfig();
  let gps;
  try {
    gps = gpsService.verifyReading(
      {
        event,
        latitude: body.latitude,
        longitude: body.longitude,
        accuracy: body.accuracy,
        clientTimestamp: body.timestamp,
      },
      gpsConfig
    );
  } catch (err) {
    await logFailed(eventId, studentId, 'checkin', err.message, parsed.token, body, meta);
    throw err;
  }

  const status = gps.outcome === 'flagged' ? 'pending_review' : ts > new Date(event.late_after || event.start_at) ? 'late' : 'present';
  const verificationStatus = gps.outcome === 'flagged' ? 'flagged' : 'qr_gps';
  const verificationReason = gps.outcome === 'flagged' ? gps.reason : null;

  const conn = await db.getConnection();
  let attendanceId;
  try {
    await conn.beginTransaction();
    // Serialize capacity checks per event; counting outside a transaction
    // allowed concurrent check-ins to overshoot max_attendance.
    if (event.max_attendance) {
      await conn.query('SELECT id FROM events WHERE id = ? FOR UPDATE', [eventId]);
      const recorded = await attendanceRepo.countRecordedForEvent(eventId, conn);
      if (recorded >= event.max_attendance) {
        throw ApiError.badRequest('This event has reached its attendance capacity.');
      }
    }
    const checkinData = {
      eventId,
      studentId,
      checkinAt: ts,
      latitude: Number(body.latitude),
      longitude: Number(body.longitude),
      accuracy: gps.accuracy,
      distance: gps.distance,
      status,
      verificationStatus,
      verificationReason,
    };
    if (existing) {
      // A manual/auto absence row can be claimed by a real check-in; the
      // guarded UPDATE makes this safe against concurrent scans.
      const claimed = await attendanceRepo.claimAbsentRow(conn, existing.id, checkinData);
      if (!claimed) {
        const row = await attendanceRepo.findByEventAndStudent(eventId, studentId);
        if (row && row.checkin_at) {
          await conn.rollback();
          return { alreadyCheckedIn: true, attendance: publicAttendance(row), event };
        }
        throw ApiError.conflict('Your attendance for this event was updated while you were checking in. Please try again.');
      }
      attendanceId = existing.id;
    } else {
      attendanceId = await attendanceRepo.insertCheckin(conn, checkinData);
    }
    await logAttempt(conn, {
      eventId,
      studentId,
      attemptType: 'checkin',
      outcome: gps.outcome === 'flagged' ? 'pending_review' : 'accepted',
      reason: verificationReason || `accepted (distance ${gps.distance} m, accuracy ±${gps.accuracy} m)`,
      qrValid: true,
      distance: gps.distance,
      accuracy: gps.accuracy,
      latitude: Number(body.latitude),
      longitude: Number(body.longitude),
      ipAddress: meta.ip,
    });
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      const row = await attendanceRepo.findByEventAndStudent(eventId, studentId);
      if (row && row.checkin_at) {
        return { alreadyCheckedIn: true, attendance: publicAttendance(row), event };
      }
      throw ApiError.conflict('Your attendance for this event was updated while you were checking in. Please try again.');
    }
    throw err;
  } finally {
    conn.release();
  }

  const attendance = await attendanceRepo.findByIdFull(attendanceId);
  await broadcastEventStats(eventId);
  notificationService
    .notifyUser(user.id, {
      title: 'Attendance recorded',
      message:
        status === 'pending_review'
          ? `Your check-in for "${event.title}" needs coordinator review.`
          : `You are checked in to "${event.title}" (${status}).`,
      type: 'attendance',
      eventId,
    })
    .catch(() => {});

  return { alreadyCheckedIn: false, attendance: publicAttendance(attendance), event };
}

async function checkOut(user, body, meta = {}) {
  const parsed = qrService.parsePayload(body.qr);
  const eventId = parsed.eventId;
  const studentId = user.studentId;

  const attendance = await attendanceRepo.findByEventAndStudent(eventId, studentId);
  if (attendance && attendance.checkout_at) {
    return { alreadyCheckedOut: true, attendance: publicAttendance(attendance), event: await eventRepo.findById(eventId) };
  }

  await qrService.validateScannedPayload(body.qr);

  if (!attendance || !attendance.checkin_at) {
    throw ApiError.badRequest('You need to check in before checking out.');
  }
  if (attendance.status === 'pending_review') {
    throw ApiError.badRequest('Your check-in is awaiting coordinator review. Check-out becomes available after it is approved.');
  }

  const event = await eventRepo.findById(eventId);
  if (!event || event.status !== 'published') {
    throw ApiError.badRequest('This event is no longer open.');
  }
  const ts = now();
  if (ts > new Date(event.end_at)) {
    throw ApiError.badRequest('The event has ended; check-out is closed.');
  }

  const gpsConfig = await settingsService.getGpsConfig();
  let gps;
  try {
    gps = gpsService.verifyReading(
      {
        event,
        latitude: body.latitude,
        longitude: body.longitude,
        accuracy: body.accuracy,
        clientTimestamp: body.timestamp,
      },
      gpsConfig
    );
  } catch (err) {
    await logFailed(eventId, studentId, 'checkout', err.message, parsed.token, body, meta);
    throw err;
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const affected = await attendanceRepo.updateCheckout(conn, attendance.id, {
      checkoutAt: ts,
      latitude: Number(body.latitude),
      longitude: Number(body.longitude),
      accuracy: gps.accuracy,
      distance: gps.distance,
    });
    await logAttempt(conn, {
      eventId,
      studentId,
      attemptType: 'checkout',
      outcome: affected ? 'accepted' : 'rejected',
      reason: affected
        ? `checked out (distance ${gps.distance} m, accuracy ±${gps.accuracy} m)`
        : 'check-out already recorded',
      qrValid: true,
      distance: gps.distance,
      accuracy: gps.accuracy,
      latitude: Number(body.latitude),
      longitude: Number(body.longitude),
      ipAddress: meta.ip,
    });
    await conn.commit();
    if (!affected) {
      const row = await attendanceRepo.findByEventAndStudent(eventId, studentId);
      if (row && row.checkout_at) {
        return { alreadyCheckedOut: true, attendance: publicAttendance(row), event };
      }
      throw ApiError.badRequest('Your check-in is awaiting coordinator review. Check-out becomes available after it is approved.');
    }
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  const updated = await attendanceRepo.findByIdFull(attendance.id);
  await broadcastEventStats(eventId);
  notificationService
    .notifyUser(user.id, {
      title: 'Checked out',
      message: `You are checked out of "${event.title}".`,
      type: 'attendance',
      eventId,
    })
    .catch(() => {});
  return { alreadyCheckedOut: false, attendance: publicAttendance(updated), event };
}

async function logFailed(eventId, studentId, attemptType, reason, tokenRecord, body, meta) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await logAttempt(conn, {
      eventId,
      studentId,
      attemptType,
      outcome: 'rejected',
      reason: String(reason).slice(0, 500),
      qrValid: !!tokenRecord,
      distance: null,
      accuracy: Number.isFinite(Number(body.accuracy)) ? Number(body.accuracy) : null,
      latitude: Number.isFinite(Number(body.latitude)) ? Number(body.latitude) : null,
      longitude: Number.isFinite(Number(body.longitude)) ? Number(body.longitude) : null,
      ipAddress: meta.ip,
    });
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    logger.error('logFailed failed:', err.message);
  } finally {
    conn.release();
  }
}

function publicAttendance(row) {
  if (!row) return null;
  return {
    id: row.id,
    eventId: row.event_id,
    status: row.status,
    checkinAt: row.checkin_at,
    checkoutAt: row.checkout_at,
    distanceMeters: row.checkin_distance_meters == null ? null : Number(row.checkin_distance_meters),
    accuracyMeters: row.checkin_accuracy_meters == null ? null : Number(row.checkin_accuracy_meters),
    verificationStatus: row.verification_status,
    verificationReason: row.verification_reason,
  };
}

// --- Manual actions (admin / assigned teacher) --------------------------------

/** Admins may act on any event; teachers only on events they are assigned to. */
async function assertEventAccess(user, eventId) {
  if (user.role === 'admin') return;
  if (user.role === 'teacher' && (await teacherAssignedToEvent(user.teacherId, eventId))) return;
  throw ApiError.forbidden('You are not allowed to manage attendance for this event.');
}

function requireReason(reason) {
  const trimmed = String(reason || '').trim();
  if (trimmed.length < 5) {
    throw ApiError.badRequest('A reason of at least 5 characters is required for manual attendance actions.');
  }
  return trimmed;
}

/** Approve or reject a pending_review record. Reason is mandatory and audited. */
async function review(user, attendanceId, decision, reason, meta = {}) {
  const trimmedReason = requireReason(reason);
  if (!['approve', 'reject'].includes(decision)) {
    throw ApiError.badRequest('Decision must be "approve" or "reject".');
  }
  const record = await attendanceRepo.findByIdFull(attendanceId);
  if (!record) throw ApiError.notFound('Attendance record not found.');
  await assertEventAccess(user, record.event_id);
  if (record.status !== 'pending_review') {
    throw ApiError.badRequest('Only records pending review can be decided on.');
  }

  const originalReason = record.verification_reason || 'flagged by GPS verification';
  let newStatus;
  let newVerification;
  let newReason;
  if (decision === 'approve') {
    const lateThreshold = record.late_after || record.start_at;
    newStatus = record.checkin_at && lateThreshold && new Date(record.checkin_at) > new Date(lateThreshold)
      ? 'late'
      : 'present';
    newVerification = 'manual';
    newReason = `Approved by ${user.username}. Original flag: ${originalReason}`;
  } else {
    newStatus = 'rejected';
    newVerification = 'flagged';
    newReason = `Rejected by ${user.username}: ${trimmedReason}. Original flag: ${originalReason}`;
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const affected = await attendanceRepo.setReviewDecision(conn, record.id, {
      status: newStatus,
      verificationStatus: newVerification,
      reason: newReason,
      reviewedBy: user.id,
    });
    if (!affected) {
      throw ApiError.conflict('This record was already reviewed by someone else.');
    }
    await attendanceRepo.insertAudit(conn, {
      attendanceId: record.id,
      actorUserId: user.id,
      action: decision,
      oldValues: { status: record.status, verification_status: record.verification_status },
      newValues: { status: newStatus, verification_status: newVerification },
      reason: trimmedReason,
      ipAddress: meta.ip,
    });
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  await broadcastEventStats(record.event_id);
  notificationService
    .notifyUser(record.user_id, {
      title: decision === 'approve' ? 'Attendance approved' : 'Attendance rejected',
      message:
        decision === 'approve'
          ? `Your attendance for "${record.event_title}" was approved (${newStatus}).`
          : `Your attendance submission for "${record.event_title}" was rejected: ${trimmedReason}`,
      type: 'attendance',
      eventId: record.event_id,
    })
    .catch(() => {});

  const updated = await attendanceRepo.findByIdFull(record.id);
  return { attendance: publicAttendance(updated) };
}

/** Manual check-in/out/absence entry by a coordinator. Reason mandatory, audited. */
async function manualEntry(user, { eventId, studentId, status, reason }, meta = {}) {
  const trimmedReason = requireReason(reason);
  if (!['present', 'late', 'absent'].includes(status)) {
    throw ApiError.badRequest('Manual status must be present, late or absent.');
  }
  await assertEventAccess(user, eventId);

  const event = await eventRepo.findById(eventId);
  if (!event || !['published', 'completed'].includes(event.status)) {
    throw ApiError.badRequest('Manual entries are only possible for published or completed events.');
  }
  const student = await studentRepo.getById(studentId);
  if (!student || student.status !== 'active') {
    throw ApiError.badRequest('Student not found or not active.');
  }
  const eligible = await eventRepo.isStudentEligible(eventId, studentId);
  if (!eligible) {
    throw ApiError.badRequest(`${student.first_name} ${student.last_name} is not on the eligible list for this event.`);
  }
  const existing = await attendanceRepo.findByEventAndStudent(eventId, studentId);
  if (existing) {
    throw ApiError.badRequest(
      'This student already has an attendance record for the event. Use the correction action instead.'
    );
  }

  const checkinAt = status === 'absent' ? null : now();
  const conn = await db.getConnection();
  let attendanceId;
  try {
    await conn.beginTransaction();
    attendanceId = await attendanceRepo.insertManual(conn, {
      eventId,
      studentId,
      checkinAt,
      status,
      reason: `Manual entry by ${user.username}: ${trimmedReason}`,
      reviewedBy: user.id,
    });
    await attendanceRepo.insertAudit(conn, {
      attendanceId,
      actorUserId: user.id,
      action: 'create_manual',
      oldValues: null,
      newValues: { status, checkin_at: checkinAt, verification_status: 'manual' },
      reason: trimmedReason,
      ipAddress: meta.ip,
    });
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  await broadcastEventStats(eventId);
  notificationService
    .notifyUser(student.user_id, {
      title: 'Attendance updated',
      message: `Your attendance for "${event.title}" was manually recorded as ${status}. Reason: ${trimmedReason}`,
      type: 'attendance',
      eventId,
    })
    .catch(() => {});

  const attendance = await attendanceRepo.findByIdFull(attendanceId);
  return { attendance: publicAttendance(attendance) };
}

/** Coordinator records a check-out on behalf of a student. */
async function manualCheckOut(user, attendanceId, reason, meta = {}) {
  const trimmedReason = requireReason(reason);
  const record = await attendanceRepo.findByIdFull(attendanceId);
  if (!record) throw ApiError.notFound('Attendance record not found.');
  await assertEventAccess(user, record.event_id);
  if (!record.checkin_at) throw ApiError.badRequest('The student has no check-in to check out from.');
  if (record.checkout_at) throw ApiError.badRequest('Check-out is already recorded.');
  if (record.status === 'pending_review') {
    throw ApiError.badRequest('This check-in is pending review. Approve or reject it before recording a check-out.');
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const affected = await attendanceRepo.updateCheckout(conn, record.id, {
      checkoutAt: now(),
      latitude: null,
      longitude: null,
      accuracy: null,
      distance: null,
    });
    if (!affected) throw ApiError.badRequest('Check-out is already recorded.');
    await attendanceRepo.insertAudit(conn, {
      attendanceId: record.id,
      actorUserId: user.id,
      action: 'manual_checkout',
      oldValues: { checkout_at: null, status: record.status },
      newValues: { status: 'checked_out' },
      reason: trimmedReason,
      ipAddress: meta.ip,
    });
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  await broadcastEventStats(record.event_id);
  notificationService
    .notifyUser(record.user_id, {
      title: 'Checked out',
      message: `Your check-out from "${record.event_title}" was recorded by a coordinator. Reason: ${trimmedReason}`,
      type: 'attendance',
      eventId: record.event_id,
    })
    .catch(() => {});

  const updated = await attendanceRepo.findByIdFull(record.id);
  return { attendance: publicAttendance(updated) };
}

/** Status correction on an existing record. Reason mandatory, old/new audited. */
async function correctStatus(user, attendanceId, { status, reason }, meta = {}) {
  const trimmedReason = requireReason(reason);
  if (!['present', 'late', 'absent'].includes(status)) {
    throw ApiError.badRequest('Corrected status must be present, late or absent.');
  }
  const record = await attendanceRepo.findByIdFull(attendanceId);
  if (!record) throw ApiError.notFound('Attendance record not found.');
  await assertEventAccess(user, record.event_id);
  if (record.status === 'checked_out') {
    throw ApiError.badRequest('Checked-out records cannot be corrected. Ask an administrator to investigate.');
  }
  if (record.status === status) {
    throw ApiError.badRequest(`The record is already marked ${status}.`);
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await attendanceRepo.setStatus(conn, record.id, {
      status,
      reason: `Corrected by ${user.username}: ${trimmedReason}`,
      reviewedBy: user.id,
    });
    await attendanceRepo.insertAudit(conn, {
      attendanceId: record.id,
      actorUserId: user.id,
      action: 'edit',
      oldValues: { status: record.status, verification_status: record.verification_status },
      newValues: { status, verification_status: 'manual' },
      reason: trimmedReason,
      ipAddress: meta.ip,
    });
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  await broadcastEventStats(record.event_id);
  notificationService
    .notifyUser(record.user_id, {
      title: 'Attendance corrected',
      message: `Your attendance for "${record.event_title}" was corrected to ${status}. Reason: ${trimmedReason}`,
      type: 'attendance',
      eventId: record.event_id,
    })
    .catch(() => {});

  const updated = await attendanceRepo.findByIdFull(record.id);
  return { attendance: publicAttendance(updated) };
}

// --- Absence finalizer ---------------------------------------------------------

/**
 * Marks every eligible student without an attendance record as absent, once
 * the check-in window closed by the configured grace period. Idempotent via
 * events.absences_finalized_at.
 */
async function finalizeAbsences() {
  const graceMinutes = await settingsService.getNumber('attendance.absent_grace_minutes', 10);
  const cutoff = new Date(Date.now() - graceMinutes * 60 * 1000);
  const events = await eventRepo.listFinalizableEvents(cutoff);
  let markedTotal = 0;

  for (const event of events) {
    const studentIds = await attendanceRepo.listEligibleWithoutAttendance(event.id);
    const finalizedAt = now();
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      await attendanceRepo.insertAbsences(
        conn,
        event.id,
        studentIds,
        'Check-in window closed without a recorded check-in',
        finalizedAt
      );
      await conn.commit();
      markedTotal += studentIds.length;
    } catch (err) {
      await conn.rollback();
      logger.error(`finalizeAbsences failed for event ${event.id}:`, err.message);
      continue;
    } finally {
      conn.release();
    }

    if (studentIds.length) {
      try {
        const mappings = await studentRepo.getUserIdsForStudents(studentIds);
        for (const { userId } of mappings) {
          await notificationService.notifyUser(userId, {
            title: 'Marked absent',
            message: `You were marked absent for "${event.title}" because no check-in was recorded before the window closed. Contact your coordinator if this is incorrect.`,
            type: 'attendance',
            eventId: event.id,
          });
        }
      } catch (err) {
        logger.error(`absence notifications failed for event ${event.id}:`, err.message);
      }
      await broadcastEventStats(event.id);
      logger.info(`[absence-finalizer] event "${event.title}": marked ${studentIds.length} student(s) absent`);
    }
  }
  return markedTotal;
}

module.exports = {
  checkIn,
  checkOut,
  broadcastEventStats,
  publicAttendance,
  review,
  manualEntry,
  manualCheckOut,
  correctStatus,
  finalizeAbsences,
};
