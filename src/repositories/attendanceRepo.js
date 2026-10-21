'use strict';

const db = require('../config/database');

async function findByEventAndStudent(eventId, studentId) {
  const [rows] = await db.query(
    'SELECT * FROM attendance WHERE event_id = ? AND student_id = ? LIMIT 1',
    [eventId, studentId]
  );
  return rows[0] || null;
}

/**
 * Inserts a check-in row. Relies on the (event_id, student_id) unique key:
 * a concurrent duplicate insert fails with ER_DUP_ENTRY and the caller
 * returns the already-stored row (idempotency).
 */
async function insertCheckin(conn, data) {
  const [result] = await conn.query(
    `INSERT INTO attendance
       (event_id, student_id, checkin_at, checkin_latitude, checkin_longitude,
        checkin_accuracy_meters, checkin_distance_meters, status, verification_status, verification_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.eventId,
      data.studentId,
      data.checkinAt,
      data.latitude,
      data.longitude,
      data.accuracy,
      data.distance,
      data.status,
      data.verificationStatus,
      data.verificationReason || null,
    ]
  );
  return result.insertId;
}

/**
 * Guarded checkout: only succeeds when checkout_at is still NULL and the
 * check-in is not awaiting coordinator review (a pending check-in must not be
 * converted into a completed attendance before review).
 */
async function updateCheckout(conn, id, data) {
  const [result] = await conn.query(
    `UPDATE attendance
        SET checkout_at = ?, checkout_latitude = ?, checkout_longitude = ?,
            checkout_accuracy_meters = ?, checkout_distance_meters = ?,
            status = 'checked_out'
      WHERE id = ? AND checkout_at IS NULL AND status <> 'pending_review'`,
    [data.checkoutAt, data.latitude, data.longitude, data.accuracy, data.distance, id]
  );
  return result.affectedRows;
}

/**
 * Claims an auto/manual absence row for a real check-in. Guarded so exactly
 * one request wins; returns affectedRows (0 = row was already claimed or
 * already has a check-in).
 */
async function claimAbsentRow(conn, id, data) {
  const [result] = await conn.query(
    `UPDATE attendance
        SET checkin_at = ?, checkin_latitude = ?, checkin_longitude = ?,
            checkin_accuracy_meters = ?, checkin_distance_meters = ?,
            status = ?, verification_status = ?, verification_reason = ?,
            reviewed_by = NULL, reviewed_at = NULL
      WHERE id = ? AND checkin_at IS NULL AND status = 'absent'`,
    [
      data.checkinAt,
      data.latitude,
      data.longitude,
      data.accuracy,
      data.distance,
      data.status,
      data.verificationStatus,
      data.verificationReason || null,
      id,
    ]
  );
  return result.affectedRows;
}

async function countByStatusForEvent(eventId) {
  const [rows] = await db.query(
    `SELECT status, COUNT(*) AS c FROM attendance WHERE event_id = ? GROUP BY status`,
    [eventId]
  );
  const out = { present: 0, late: 0, checked_out: 0, absent: 0, pending_review: 0, rejected: 0 };
  rows.forEach((r) => {
    out[r.status] = r.c;
  });
  return out;
}

async function countRecordedForEvent(eventId, conn = db) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS c FROM attendance
      WHERE event_id = ? AND status IN ('present','late','checked_out','pending_review')`,
    [eventId]
  );
  return rows[0].c;
}

async function countForEvent(eventId, { status } = {}) {
  const params = [eventId];
  let where = 'event_id = ?';
  if (status) {
    where += ' AND status = ?';
    params.push(status);
  }
  const [rows] = await db.query(`SELECT COUNT(*) AS c FROM attendance WHERE ${where}`, params);
  return rows[0].c;
}

async function listForEvent(eventId, { status, limit, offset }) {
  const params = [eventId];
  let where = 'a.event_id = ?';
  if (status) {
    where += ' AND a.status = ?';
    params.push(status);
  }
  const [rows] = await db.query(
    `SELECT a.*, s.student_number, s.first_name, s.last_name,
            g.name AS grade_level_name, sec.name AS section_name
       FROM attendance a
       JOIN students s ON s.id = a.student_id
       LEFT JOIN grade_levels g ON g.id = s.grade_level_id
       LEFT JOIN sections sec ON sec.id = s.section_id
      WHERE ${where}
      ORDER BY COALESCE(a.checkin_at, a.created_at) DESC, a.id DESC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return rows;
}

async function listFlagged({ eventId, limit, offset }) {
  const params = [];
  // Rejected rows keep verification_status='flagged' for provenance, so the
  // queue is defined solely by status; otherwise decided records never leave it.
  let where = "a.status = 'pending_review'";
  if (eventId) {
    where += ' AND a.event_id = ?';
    params.push(eventId);
  }
  const [countRows] = await db.query(`SELECT COUNT(*) AS total FROM attendance a WHERE ${where}`, params);
  const [rows] = await db.query(
    `SELECT a.*, s.student_number, s.first_name, s.last_name, e.title AS event_title,
            g.name AS grade_level_name, sec.name AS section_name
       FROM attendance a
       JOIN students s ON s.id = a.student_id
       JOIN events e ON e.id = a.event_id
       LEFT JOIN grade_levels g ON g.id = s.grade_level_id
       LEFT JOIN sections sec ON sec.id = s.section_id
      WHERE ${where}
      ORDER BY a.created_at DESC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return { rows, total: countRows[0].total };
}

async function findByIdFull(id) {
  const [rows] = await db.query(
    `SELECT a.*, e.title AS event_title, e.status AS event_status,
            e.checkin_closes_at, e.end_at, e.checkout_required, e.late_after, e.start_at,
            s.student_number, s.first_name, s.last_name, s.user_id
       FROM attendance a
       JOIN events e ON e.id = a.event_id
       JOIN students s ON s.id = a.student_id
      WHERE a.id = ? LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

/** Applies a review decision (approve/reject) to a pending_review row. */
async function setReviewDecision(conn, id, { status, verificationStatus, reason, reviewedBy }) {
  const [result] = await conn.query(
    `UPDATE attendance
        SET status = ?, verification_status = ?, verification_reason = ?,
            reviewed_by = ?, reviewed_at = UTC_TIMESTAMP()
      WHERE id = ? AND status = 'pending_review'`,
    [status, verificationStatus, String(reason).slice(0, 500), reviewedBy, id]
  );
  return result.affectedRows;
}

/** Manual status correction on an existing record. */
async function setStatus(conn, id, { status, reason, reviewedBy }) {
  const [result] = await conn.query(
    `UPDATE attendance
        SET status = ?, verification_status = 'manual', verification_reason = ?,
            reviewed_by = ?, reviewed_at = UTC_TIMESTAMP()
      WHERE id = ?`,
    [status, String(reason).slice(0, 500), reviewedBy, id]
  );
  return result.affectedRows;
}

/** Manual check-in: creates a record without QR/GPS. */
async function insertManual(conn, data) {
  const [result] = await conn.query(
    `INSERT INTO attendance
       (event_id, student_id, checkin_at, status, verification_status, verification_reason,
        reviewed_by, reviewed_at)
     VALUES (?, ?, ?, ?, 'manual', ?, ?, UTC_TIMESTAMP())`,
    [
      data.eventId,
      data.studentId,
      data.checkinAt,
      data.status,
      String(data.reason).slice(0, 500),
      data.reviewedBy,
    ]
  );
  return result.insertId;
}

// --- Attendance audit logs ---------------------------------------------------

async function insertAudit(conn, { attendanceId, actorUserId, action, oldValues, newValues, reason, ipAddress }) {
  await conn.query(
    `INSERT INTO attendance_audit_logs
       (attendance_id, actor_user_id, action, old_values, new_values, reason, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      attendanceId,
      actorUserId,
      action,
      oldValues ? JSON.stringify(oldValues) : null,
      newValues ? JSON.stringify(newValues) : null,
      String(reason).slice(0, 500),
      ipAddress || null,
    ]
  );
}

async function listAuditForAttendance(attendanceId) {
  const [rows] = await db.query(
    `SELECT l.*, u.username AS actor_username, u.role AS actor_role
       FROM attendance_audit_logs l
       JOIN users u ON u.id = l.actor_user_id
      WHERE l.attendance_id = ?
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT 100`,
    [attendanceId]
  );
  return rows;
}

// --- Absence finalization ----------------------------------------------------

/**
 * Eligible students with no attendance row for the event. Mirrors the
 * eligibility semantics of eventRepo.listForStudent: no eligibility rows on
 * the event means every active student is included.
 */
async function listEligibleWithoutAttendance(eventId) {
  const [rows] = await db.query(
    `SELECT s.id
       FROM students s
      WHERE s.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM attendance a WHERE a.event_id = ? AND a.student_id = s.id
        )
        AND (
          (
            NOT EXISTS (SELECT 1 FROM event_eligible_students x WHERE x.event_id = ?)
            AND NOT EXISTS (SELECT 1 FROM event_eligible_groups g WHERE g.event_id = ?)
          )
          OR EXISTS (
            SELECT 1 FROM event_eligible_students x
             WHERE x.event_id = ? AND x.student_id = s.id
          )
          OR EXISTS (
            SELECT 1 FROM event_eligible_groups g
             WHERE g.event_id = ? AND (g.grade_level_id = s.grade_level_id OR g.section_id = s.section_id)
          )
        )`,
    [eventId, eventId, eventId, eventId, eventId]
  );
  return rows.map((r) => r.id);
}

async function insertAbsences(conn, eventId, studentIds, reason, finalizedAt) {
  if (!studentIds.length) {
    await conn.query('UPDATE events SET absences_finalized_at = ? WHERE id = ?', [finalizedAt, eventId]);
    return 0;
  }
  const values = [];
  const params = [];
  for (const sid of studentIds) {
    values.push('(?, ?, ?, ?, ?, ?)');
    params.push(eventId, sid, null, 'absent', 'auto', reason);
  }
  await conn.query(
    `INSERT INTO attendance
       (event_id, student_id, checkin_at, status, verification_status, verification_reason)
     VALUES ${values.join(',')}
     ON DUPLICATE KEY UPDATE id = id`,
    params
  );
  await conn.query('UPDATE events SET absences_finalized_at = ? WHERE id = ?', [finalizedAt, eventId]);
  return studentIds.length;
}

async function listForStudent(studentId, { limit, offset }) {
  const [countRows] = await db.query(
    'SELECT COUNT(*) AS total FROM attendance WHERE student_id = ?',
    [studentId]
  );
  const [rows] = await db.query(
    `SELECT a.*, e.title AS event_title, e.venue_name, e.category, e.start_at
       FROM attendance a JOIN events e ON e.id = a.event_id
      WHERE a.student_id = ?
      ORDER BY e.start_at DESC, a.id DESC
      LIMIT ? OFFSET ?`,
    [studentId, limit, offset]
  );
  return { rows, total: countRows[0].total };
}

// --- Verification logs -------------------------------------------------------

async function insertVerificationLog(conn, data) {
  await conn.query(
    `INSERT INTO attendance_verification_logs
       (event_id, student_id, attempt_type, outcome, reason, qr_valid,
        distance_meters, accuracy_meters, latitude, longitude, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.eventId,
      data.studentId,
      data.attemptType,
      data.outcome,
      data.reason || null,
      data.qrValid ? 1 : 0,
      data.distance ?? null,
      data.accuracy ?? null,
      data.latitude ?? null,
      data.longitude ?? null,
      data.ipAddress || null,
    ]
  );
}

async function listVerificationLogs({ eventId, outcome, limit, offset }) {
  const where = [];
  const params = [];
  if (eventId) {
    where.push('v.event_id = ?');
    params.push(eventId);
  }
  if (outcome) {
    where.push('v.outcome = ?');
    params.push(outcome);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [countRows] = await db.query(
    `SELECT COUNT(*) AS total FROM attendance_verification_logs v ${whereSql}`,
    params
  );
  const [rows] = await db.query(
    `SELECT v.*, s.student_number, s.first_name, s.last_name, e.title AS event_title
       FROM attendance_verification_logs v
       JOIN students s ON s.id = v.student_id
       JOIN events e ON e.id = v.event_id
       ${whereSql}
       ORDER BY v.created_at DESC, v.id DESC
       LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return { rows, total: countRows[0].total };
}

module.exports = {
  findByEventAndStudent,
  insertCheckin,
  updateCheckout,
  claimAbsentRow,
  countByStatusForEvent,
  countRecordedForEvent,
  countForEvent,
  listForEvent,
  listFlagged,
  findByIdFull,
  listForStudent,
  setReviewDecision,
  setStatus,
  insertManual,
  insertAudit,
  listAuditForAttendance,
  listEligibleWithoutAttendance,
  insertAbsences,
  insertVerificationLog,
  listVerificationLogs,
};
