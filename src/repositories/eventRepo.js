'use strict';

const db = require('../config/database');

const EVENT_FIELDS = `e.id, e.title, e.description, e.category, e.poster_path, e.venue_name,
  e.latitude, e.longitude, e.radius_meters, e.max_gps_accuracy_meters,
  e.start_at, e.end_at, e.checkin_opens_at, e.checkin_closes_at, e.late_after,
  e.checkout_required, e.max_attendance, e.status, e.created_by, e.created_at, e.updated_at`;

async function create(conn, data) {
  const [result] = await conn.query(
    `INSERT INTO events
       (title, description, category, poster_path, venue_name, latitude, longitude,
        radius_meters, max_gps_accuracy_meters, start_at, end_at, checkin_opens_at,
        checkin_closes_at, late_after, checkout_required, max_attendance, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.title,
      data.description || null,
      data.category || null,
      data.posterPath || null,
      data.venueName,
      data.latitude,
      data.longitude,
      data.radiusMeters,
      data.maxGpsAccuracyMeters,
      data.startAt,
      data.endAt,
      data.checkinOpensAt,
      data.checkinClosesAt,
      data.lateAfter || null,
      data.checkoutRequired ? 1 : 0,
      data.maxAttendance || null,
      data.status || 'draft',
      data.createdBy,
    ]
  );
  return result.insertId;
}

async function update(conn, id, data) {
  await conn.query(
    `UPDATE events SET
       title = ?, description = ?, category = ?, poster_path = COALESCE(?, poster_path),
       venue_name = ?, latitude = ?, longitude = ?, radius_meters = ?,
       max_gps_accuracy_meters = ?, start_at = ?, end_at = ?, checkin_opens_at = ?,
       checkin_closes_at = ?, late_after = ?, checkout_required = ?, max_attendance = ?
     WHERE id = ?`,
    [
      data.title,
      data.description || null,
      data.category || null,
      data.posterPath || null,
      data.venueName,
      data.latitude,
      data.longitude,
      data.radiusMeters,
      data.maxGpsAccuracyMeters,
      data.startAt,
      data.endAt,
      data.checkinOpensAt,
      data.checkinClosesAt,
      data.lateAfter || null,
      data.checkoutRequired ? 1 : 0,
      data.maxAttendance || null,
      id,
    ]
  );
}

async function findById(id) {
  const [rows] = await db.query(
    `SELECT ${EVENT_FIELDS}, u.username AS creator_username
       FROM events e JOIN users u ON u.id = e.created_by
      WHERE e.id = ? LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function list({ status, search, teacherId, limit, offset }) {
  const where = [];
  const params = [];
  if (status) {
    where.push('e.status = ?');
    params.push(status);
  }
  if (search) {
    where.push('(e.title LIKE ? OR e.venue_name LIKE ? OR e.category LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  if (teacherId) {
    where.push('EXISTS (SELECT 1 FROM event_assignments ea WHERE ea.event_id = e.id AND ea.teacher_id = ?)');
    params.push(teacherId);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [countRows] = await db.query(`SELECT COUNT(*) AS total FROM events e ${whereSql}`, params);
  const [rows] = await db.query(
    `SELECT ${EVENT_FIELDS},
            (SELECT COUNT(*) FROM event_assignments ea WHERE ea.event_id = e.id) AS assignment_count
       FROM events e ${whereSql}
       ORDER BY e.start_at DESC, e.id DESC
       LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return { rows, total: countRows[0].total };
}

/** Events relevant to a student: published + (no eligibility set => open, else eligible). */
async function listForStudent(studentId, { includePast = false, limit = 50 } = {}) {
  const pastFilter = includePast ? '' : 'AND e.end_at >= UTC_TIMESTAMP()';
  const [rows] = await db.query(
    `SELECT ${EVENT_FIELDS},
            a.id AS attendance_id, a.status AS attendance_status, a.checkout_at AS attendance_checkout_at
       FROM events e
       LEFT JOIN attendance a ON a.event_id = e.id AND a.student_id = ?
      WHERE e.status = 'published'
        AND (
          NOT EXISTS (SELECT 1 FROM event_eligible_students x WHERE x.event_id = e.id)
          AND NOT EXISTS (SELECT 1 FROM event_eligible_groups g WHERE g.event_id = e.id)
          OR EXISTS (SELECT 1 FROM event_eligible_students x WHERE x.event_id = e.id AND x.student_id = ?)
          OR EXISTS (
            SELECT 1 FROM event_eligible_groups g
             WHERE g.event_id = e.id
               AND (g.grade_level_id = (SELECT s.grade_level_id FROM students s WHERE s.id = ?)
                    OR g.section_id = (SELECT s.section_id FROM students s WHERE s.id = ?))
          )
        )
        ${pastFilter}
      ORDER BY e.start_at ASC
      LIMIT ?`,
    [studentId, studentId, studentId, studentId, limit]
  );
  return rows;
}

/** Single-event eligibility check used by attendance submission. */
async function isStudentEligible(eventId, studentId) {
  const [counts] = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM event_eligible_students WHERE event_id = ?) AS explicit_count,
       (SELECT COUNT(*) FROM event_eligible_groups WHERE event_id = ?) AS group_count`,
    [eventId, eventId]
  );
  const { explicit_count, group_count } = counts[0];
  if (explicit_count === 0 && group_count === 0) return true; // open to all active students
  if (explicit_count > 0) {
    const [rows] = await db.query(
      'SELECT 1 FROM event_eligible_students WHERE event_id = ? AND student_id = ? LIMIT 1',
      [eventId, studentId]
    );
    if (rows.length) return true;
  }
  if (group_count > 0) {
    const [rows] = await db.query(
      `SELECT 1 FROM event_eligible_groups g
        JOIN students s ON s.id = ?
       WHERE g.event_id = ?
         AND (g.grade_level_id = s.grade_level_id OR g.section_id = s.section_id)
       LIMIT 1`,
      [studentId, eventId]
    );
    if (rows.length) return true;
  }
  return false;
}

async function countEligibleStudents(eventId) {
  const [rows] = await db.query(
    `SELECT COUNT(DISTINCT s.id) AS c FROM students s
      WHERE s.status = 'active' AND (
        (
          NOT EXISTS (SELECT 1 FROM event_eligible_students x WHERE x.event_id = ?)
          AND NOT EXISTS (SELECT 1 FROM event_eligible_groups g WHERE g.event_id = ?)
        )
        OR EXISTS (SELECT 1 FROM event_eligible_students x WHERE x.event_id = ? AND x.student_id = s.id)
        OR EXISTS (
          SELECT 1 FROM event_eligible_groups g
           WHERE g.event_id = ? AND (g.grade_level_id = s.grade_level_id OR g.section_id = s.section_id)
        )
      )`,
    [eventId, eventId, eventId, eventId]
  );
  return rows[0].c;
}

/** Full eligible-student roster (for printable sign-in sheets). */
async function listEligibleStudentRecords(eventId) {
  const [rows] = await db.query(
    `SELECT s.student_number, s.first_name, s.last_name,
            g.name AS grade_level_name, sec.name AS section_name
       FROM students s
       LEFT JOIN grade_levels g ON g.id = s.grade_level_id
       LEFT JOIN sections sec ON sec.id = s.section_id
      WHERE s.status = 'active'
        AND (
          (
            NOT EXISTS (SELECT 1 FROM event_eligible_students x WHERE x.event_id = ?)
            AND NOT EXISTS (SELECT 1 FROM event_eligible_groups gg WHERE gg.event_id = ?)
          )
          OR EXISTS (SELECT 1 FROM event_eligible_students x WHERE x.event_id = ? AND x.student_id = s.id)
          OR EXISTS (
            SELECT 1 FROM event_eligible_groups gg
             WHERE gg.event_id = ? AND (gg.grade_level_id = s.grade_level_id OR gg.section_id = s.section_id)
          )
        )
      ORDER BY s.last_name, s.first_name`,
    [eventId, eventId, eventId, eventId]
  );
  return rows;
}

/** Published events starting within the reminder horizon that were not reminded yet. */
async function listEventsForReminder(horizonCutoff) {
  const [rows] = await db.query(
    `SELECT id, title, venue_name, start_at, checkin_opens_at
       FROM events
      WHERE status = 'published'
        AND reminders_sent_at IS NULL
        AND start_at > UTC_TIMESTAMP()
        AND start_at <= ?`,
    [horizonCutoff]
  );
  return rows;
}

async function markRemindersSent(eventId) {
  await db.query('UPDATE events SET reminders_sent_at = UTC_TIMESTAMP() WHERE id = ?', [eventId]);
}

/** Published/completed events whose check-in window closed but absences were not finalized yet. */
async function listFinalizableEvents(graceCutoff) {
  const [rows] = await db.query(
    `SELECT id, title, checkin_closes_at, late_after, start_at
       FROM events
      WHERE status IN ('published', 'completed')
        AND absences_finalized_at IS NULL
        AND checkin_closes_at <= ?`,
    [graceCutoff]
  );
  return rows;
}

/**
 * Active, event-eligible students matching a search term (student number or
 * name). Used by the manual check-in picker on the event management screen.
 */
async function searchEligibleStudents(eventId, term, limit = 20) {
  const like = `%${term}%`;
  const [rows] = await db.query(
    `SELECT s.id, s.student_number, s.first_name, s.last_name,
            g.name AS grade_level_name, sec.name AS section_name
       FROM students s
       LEFT JOIN grade_levels g ON g.id = s.grade_level_id
       LEFT JOIN sections sec ON sec.id = s.section_id
      WHERE s.status = 'active'
        AND s.id NOT IN (SELECT student_id FROM attendance WHERE event_id = ?)
        AND (s.student_number LIKE ? OR s.first_name LIKE ? OR s.last_name LIKE ?)
        AND (
          (
            NOT EXISTS (SELECT 1 FROM event_eligible_students x WHERE x.event_id = ?)
            AND NOT EXISTS (SELECT 1 FROM event_eligible_groups gg WHERE gg.event_id = ?)
          )
          OR EXISTS (SELECT 1 FROM event_eligible_students x WHERE x.event_id = ? AND x.student_id = s.id)
          OR EXISTS (
            SELECT 1 FROM event_eligible_groups gg
             WHERE gg.event_id = ? AND (gg.grade_level_id = s.grade_level_id OR gg.section_id = s.section_id)
          )
        )
      ORDER BY s.last_name, s.first_name
      LIMIT ?`,
    [eventId, like, like, like, eventId, eventId, eventId, eventId, limit]
  );
  return rows;
}

async function setStatus(conn, id, status) {
  await conn.query('UPDATE events SET status = ? WHERE id = ?', [status, id]);
}

// --- Eligibility ------------------------------------------------------------

async function getEligibility(eventId) {
  const [grades] = await db.query(
    `SELECT g.grade_level_id AS id, gl.name FROM event_eligible_groups g
       JOIN grade_levels gl ON gl.id = g.grade_level_id
      WHERE g.event_id = ? AND g.grade_level_id IS NOT NULL`,
    [eventId]
  );
  const [sections] = await db.query(
    `SELECT g.section_id AS id, sec.name, gl.name AS grade_level_name
       FROM event_eligible_groups g
       JOIN sections sec ON sec.id = g.section_id
       JOIN grade_levels gl ON gl.id = sec.grade_level_id
      WHERE g.event_id = ? AND g.section_id IS NOT NULL`,
    [eventId]
  );
  const [students] = await db.query(
    `SELECT s.id, s.student_number, s.first_name, s.last_name
       FROM event_eligible_students x JOIN students s ON s.id = x.student_id
      WHERE x.event_id = ?
      ORDER BY s.last_name, s.first_name`,
    [eventId]
  );
  return { grades, sections, students };
}

async function setEligibility(conn, eventId, { gradeIds = [], sectionIds = [], studentIds = [] }) {
  await conn.query('DELETE FROM event_eligible_groups WHERE event_id = ?', [eventId]);
  await conn.query('DELETE FROM event_eligible_students WHERE event_id = ?', [eventId]);
  for (const gid of gradeIds) {
    await conn.query(
      `INSERT INTO event_eligible_groups (event_id, grade_level_id) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE grade_level_id = grade_level_id`,
      [eventId, gid]
    );
  }
  for (const sid of sectionIds) {
    await conn.query(
      `INSERT INTO event_eligible_groups (event_id, section_id) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE section_id = section_id`,
      [eventId, sid]
    );
  }
  for (const stid of studentIds) {
    await conn.query(
      'INSERT INTO event_eligible_students (event_id, student_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE student_id = student_id',
      [eventId, stid]
    );
  }
}

// --- Assignments ------------------------------------------------------------

async function getAssignments(eventId) {
  const [rows] = await db.query(
    `SELECT ea.teacher_id, t.employee_number, t.first_name, t.last_name, u.username
       FROM event_assignments ea
       JOIN teachers t ON t.id = ea.teacher_id
       JOIN users u ON u.id = t.user_id
      WHERE ea.event_id = ?`,
    [eventId]
  );
  return rows;
}

async function setAssignments(conn, eventId, teacherIds, assignedBy) {
  await conn.query('DELETE FROM event_assignments WHERE event_id = ?', [eventId]);
  for (const tid of teacherIds) {
    await conn.query(
      'INSERT INTO event_assignments (event_id, teacher_id, assigned_by) VALUES (?, ?, ?)',
      [eventId, tid, assignedBy]
    );
  }
}

async function listForTeacher(teacherId) {
  const [rows] = await db.query(
    `SELECT ${EVENT_FIELDS}
       FROM events e JOIN event_assignments ea ON ea.event_id = e.id
      WHERE ea.teacher_id = ?
      ORDER BY e.start_at DESC`,
    [teacherId]
  );
  return rows;
}

module.exports = {
  create,
  update,
  findById,
  list,
  listForStudent,
  listForTeacher,
  isStudentEligible,
  countEligibleStudents,
  listFinalizableEvents,
  listEligibleStudentRecords,
  listEventsForReminder,
  markRemindersSent,
  searchEligibleStudents,
  setStatus,
  getEligibility,
  setEligibility,
  getAssignments,
  setAssignments,
};
