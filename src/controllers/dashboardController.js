'use strict';

const studentRepo = require('../repositories/studentRepo');
const eventRepo = require('../repositories/eventRepo');
const db = require('../config/database');
const { asyncHandler } = require('../utils/asyncHandler');
const settingsService = require('../services/settingsService');

const STATUS_COLUMNS = `SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) AS present,
  SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) AS late,
  SUM(CASE WHEN status = 'checked_out' THEN 1 ELSE 0 END) AS checked_out,
  SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) AS absent,
  SUM(CASE WHEN status = 'pending_review' THEN 1 ELSE 0 END) AS pending_review`;

async function getAdminSummary() {
  const [studentCounts, eventCounts, attendanceTotals] = await Promise.all([
    studentRepo.countByStatus(),
    db.query(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'published' AND end_at >= UTC_TIMESTAMP() THEN 1 ELSE 0 END) AS upcoming_active,
         SUM(CASE WHEN status = 'published' AND start_at <= UTC_TIMESTAMP() AND end_at >= UTC_TIMESTAMP() THEN 1 ELSE 0 END) AS ongoing
       FROM events`
    ),
    db.query(`SELECT ${STATUS_COLUMNS}, COUNT(*) AS total FROM attendance`),
  ]);
  const events = eventCounts[0][0];
  const attendance = attendanceTotals[0][0] || {};
  return {
    students: studentCounts,
    events: {
      total: events.total || 0,
      upcoming: events.upcoming_active || 0,
      ongoing: events.ongoing || 0,
    },
    attendance: {
      present: Number(attendance.present) || 0,
      late: Number(attendance.late) || 0,
      checkedOut: Number(attendance.checked_out) || 0,
      absent: Number(attendance.absent) || 0,
      pendingReview: Number(attendance.pending_review) || 0,
      total: Number(attendance.total) || 0,
    },
  };
}

const adminPage = asyncHandler(async (req, res) => {
  const [summary, recent] = await Promise.all([
    getAdminSummary(),
    db.query(
      `SELECT a.id, a.status, a.checkin_at, s.first_name, s.last_name, s.student_number, e.title AS event_title
         FROM attendance a
         JOIN students s ON s.id = a.student_id
         JOIN events e ON e.id = a.event_id
        ORDER BY COALESCE(a.checkin_at, a.created_at) DESC
        LIMIT 8`
    ),
  ]);
  res.render('admin/dashboard', {
    title: 'Admin Dashboard',
    summary,
    recent: recent[0],
  });
});

const teacherPage = asyncHandler(async (req, res) => {
  const events = await eventRepo.listForTeacher(req.user.teacherId);
  const now = new Date();
  const settings = await settingsService.getPublicConfig();
  res.render('teacher/dashboard', {
    title: 'Teacher Dashboard',
    events,
    now,
    settings,
  });
});

const teacherEventsPage = asyncHandler(async (req, res) => {
  const events = await eventRepo.listForTeacher(req.user.teacherId);
  res.render('teacher/events', { title: 'My Events', events });
});

/** Live summary for the admin dashboard (polled by the client). */
const summaryApi = asyncHandler(async (req, res) => {
  res.json(await getAdminSummary());
});

module.exports = { adminPage, teacherPage, teacherEventsPage, summaryApi, getAdminSummary };
