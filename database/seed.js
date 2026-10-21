/**
 * Seed script - fills the database with FICTIONAL development data.
 * Destructive: truncates all data tables. Development use only.
 *
 *   npm run db:seed
 */
require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const config = require('../src/config/environment');

const SCHOOLS_COORDS = { lat: 14.599512, lng: 120.984222 };

const FIRST_NAMES = [
  'Maria', 'Juan', 'Jose', 'Ana', 'Pedro', 'Sofia', 'Miguel', 'Isabella', 'Andres', 'Camille',
  'Rafael', 'Jasmine', 'Diego', 'Gabriela', 'Enrique', 'Lucia', 'Marco', 'Elena', 'Carlos', 'Rosa',
  'Nathaniel', 'Bea', 'Ferdinand', 'Corazon', 'Emilio', 'Teresa', 'Paolo', 'Gracia', 'Lorenzo', 'Althea',
];
const MIDDLE_INITIALS = 'ABCDEFGHJKLMNPRSTVWY';
const LAST_NAMES = [
  'Dela Cruz', 'Santos', 'Reyes', 'Bautista', 'Ocampo', 'Garcia', 'Mendoza', 'Villanueva', 'Aquino', 'Rivera',
  'Castillo', 'Flores', 'Torres', 'Ramos', 'Navarro', 'Salvador', 'Domingo', 'Mercado', 'Lumbao', 'Cabrera',
];
const SECTION_NAMES = [
  ['Sampaguita', 'Ilang-Ilang'],
  ['Molave', 'Narra'],
  ['Acacia', 'Kamagong'],
  ['Yakal', 'Apitong'],
  ['Lawaan', 'Guijo'],
  ['Bagtikan', 'Tindalo'],
];

function pick(arr, i) {
  return arr[i % arr.length];
}

function pad(n, width) {
  return String(n).padStart(width, '0');
}

function utc(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

async function main() {
  const connection = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    multipleStatements: false,
    timezone: 'Z',
    charset: 'utf8mb4_unicode_ci',
  });

  const q = (sql, params) => connection.query(sql, params);
  const now = new Date();

  console.log('[seed] WARNING: this truncates all data tables (development only).');
  await q('SET FOREIGN_KEY_CHECKS = 0');
  for (const table of [
    'attendance_audit_logs', 'attendance_verification_logs', 'attendance', 'qr_tokens',
    'event_eligible_students', 'event_eligible_groups', 'event_assignments', 'events',
    'push_subscriptions', 'notifications', 'notification_preferences', 'students', 'teachers',
    'sections', 'grade_levels', 'school_years', 'audit_logs', 'login_security_logs',
    'system_settings', 'users',
  ]) {
    await q(`TRUNCATE TABLE ${table}`);
  }
  await q('SET FOREIGN_KEY_CHECKS = 1');

  // --- Users -------------------------------------------------------------
  const adminPassword = config.seed.adminPassword || 'Admin@12345';
  const adminHash = await bcrypt.hash(adminPassword, 10);
  const [adminResult] = await q(
    `INSERT INTO users (username, email, password_hash, role, status)
     VALUES (?, 'admin@sample.edu', ?, 'admin', 'active')`,
    [config.seed.adminUsername, adminHash]
  );
  const adminId = adminResult.insertId;

  const studentHash = await bcrypt.hash('Student@123', 10);
  const teacherHash = await bcrypt.hash('Teacher@123', 10);

  const teacherDefs = [
    ['e.dolor', 'Elena', 'Dolor'],
    ['r.bautista', 'Ricardo', 'Bautista'],
    ['m.salvador', 'Marites', 'Salvador'],
    ['f.navarro', 'Ferdinand', 'Navarro'],
  ];
  const teacherIds = [];
  for (let i = 0; i < teacherDefs.length; i += 1) {
    const [username, first, last] = teacherDefs[i];
    const [u] = await q(
      `INSERT INTO users (username, email, password_hash, role, status)
       VALUES (?, ?, ?, 'teacher', 'active')`,
      [username, `${username}@sample.edu`, teacherHash]
    );
    const [t] = await q(
      `INSERT INTO teachers (user_id, employee_number, first_name, last_name, status)
       VALUES (?, ?, ?, ?, 'active')`,
      [u.insertId, `EMP-${pad(100 + i, 4)}`, first, last]
    );
    teacherIds.push(t.insertId);
  }

  // --- Academic structure --------------------------------------------------
  const [sy] = await q(
    `INSERT INTO school_years (name, start_date, end_date, status)
     VALUES ('2026-2027', '2026-06-01', '2027-03-31', 'active')`
  );
  const schoolYearId = sy.insertId;

  const gradeIds = [];
  for (let g = 7; g <= 12; g += 1) {
    const [row] = await q(
      'INSERT INTO grade_levels (name, sort_order) VALUES (?, ?)',
      [`Grade ${g}`, g - 7]
    );
    gradeIds.push(row.insertId);
  }

  const sectionIdsByGrade = {};
  let studentCounter = 0;
  const studentRows = []; // {userId, studentId, gradeIndex, sectionId, name}

  for (let gi = 0; gi < gradeIds.length; gi += 1) {
    sectionIdsByGrade[gi] = [];
    for (let si = 0; si < SECTION_NAMES[gi].length; si += 1) {
      const [section] = await q(
        `INSERT INTO sections (grade_level_id, school_year_id, name, status)
         VALUES (?, ?, ?, 'active')`,
        [gradeIds[gi], schoolYearId, SECTION_NAMES[gi][si]]
      );
      sectionIdsByGrade[gi].push(section.insertId);
    }
  }

  const studentsPerSection = config.seed.studentsPerSection;
  for (let gi = 0; gi < gradeIds.length; gi += 1) {
    for (const sectionId of sectionIdsByGrade[gi]) {
      for (let n = 0; n < studentsPerSection; n += 1) {
        const first = pick(FIRST_NAMES, studentCounter * 7 + 3);
        const middle = MIDDLE_INITIALS[(studentCounter * 5) % MIDDLE_INITIALS.length];
        const last = pick(LAST_NAMES, studentCounter * 11 + 1);
        const studentNumber = `2026-${pad(studentCounter + 1, 4)}`;
        const username = studentNumber;
        const [u] = await q(
          `INSERT INTO users (username, email, password_hash, role, status)
           VALUES (?, ?, ?, 'student', 'active')`,
          [username, `${username}@student.sample.edu`, studentHash]
        );
        const [s] = await q(
          `INSERT INTO students
             (user_id, student_number, first_name, middle_name, last_name,
              grade_level_id, section_id, school_year_id, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
          [u.insertId, studentNumber, first, middle, last, gradeIds[gi], sectionId, schoolYearId]
        );
        studentRows.push({ userId: u.insertId, studentId: s.insertId, gradeIndex: gi, sectionId, first, middle, last });
        studentCounter += 1;
      }
    }
  }

  // --- System settings defaults -------------------------------------------
  const defaults = [
    ['site.name', config.school.name],
    ['site.timezone', config.school.timezone],
    ['qr.rotation_seconds', String(config.qr.rotationSeconds)],
    ['qr.token_ttl_seconds', String(config.qr.tokenTtlSeconds)],
    ['gps.default_radius_meters', String(config.gps.defaultRadiusMeters)],
    ['gps.max_accuracy_meters', String(config.gps.maxAccuracyMeters)],
    ['gps.freshness_seconds', String(config.gps.freshnessSeconds)],
    ['gps.flag_distance_multiplier', String(config.gps.flagDistanceMultiplier)],
    ['attendance.absent_grace_minutes', '10'],
    ['notification.email_enabled', config.smtp.enabled ? 'true' : 'false'],
    ['notification.push_enabled', config.vapid.publicKey ? 'true' : 'false'],
    ['notification.reminder_hours_before', '24'],  ];
  for (const [key, value] of defaults) {
    await q(
      'INSERT INTO system_settings (setting_key, setting_value, updated_by) VALUES (?, ?, ?)',
      [key, value, adminId]
    );
  }

  // --- Events --------------------------------------------------------------
  const day = 24 * 60 * 60 * 1000;
  const hour = 60 * 60 * 1000;

  // 1. Completed event one week ago (with attendance history)
  const completedStart = new Date(now.getTime() - 7 * day);
  const [evCompleted] = await q(
    `INSERT INTO events
       (title, description, category, venue_name, latitude, longitude,
        radius_meters, max_gps_accuracy_meters, start_at, end_at,
        checkin_opens_at, checkin_closes_at, late_after, checkout_required,
        status, created_by)
     VALUES
       ('Buwan ng Wika Opening Ceremony',
        'Fictional sample event: opening program for the language month celebration.',
        'Cultural', 'School Quadrangle', ?, ?, 60, 50, ?, ?, ?, ?, ?, 1,
        'completed', ?)`,
    [
      SCHOOLS_COORDS.lat, SCHOOLS_COORDS.lng,
      utc(completedStart),
      utc(new Date(completedStart.getTime() + 3 * hour)),
      utc(new Date(completedStart.getTime() - hour)),
      utc(new Date(completedStart.getTime() + 30 * 60 * 1000)),
      utc(completedStart),
      adminId,
    ]
  );
  await q(
    `INSERT INTO event_eligible_groups (event_id, grade_level_id) VALUES (?, ?), (?, ?)`,
    [evCompleted.insertId, gradeIds[0], evCompleted.insertId, gradeIds[1]]
  );
  await q(
    'INSERT INTO event_assignments (event_id, teacher_id, assigned_by) VALUES (?, ?, ?)',
    [evCompleted.insertId, teacherIds[0], adminId]
  );

  const eligibleGrades78 = studentRows.filter((s) => s.gradeIndex <= 1);
  for (const s of eligibleGrades78) {
    const roll = Math.random();
    if (roll < 0.05) {
      await q(
        `INSERT INTO attendance (event_id, student_id, status, verification_status, verification_reason)
         VALUES (?, ?, 'absent', 'qr_gps', 'No check-in received before deadline')`,
        [evCompleted.insertId, s.studentId]
      );
      continue;
    }
    const late = roll > 0.9;
    const checkedOut = roll > 0.25;
    const checkinAt = new Date(
      completedStart.getTime() + (late ? 22 * 60 * 1000 : Math.floor(Math.random() * 25)) * 60 * 1000
    );
    const dist = (Math.random() * 40 + 3).toFixed(2);
    const acc = (Math.random() * 25 + 5).toFixed(2);
    await q(
      `INSERT INTO attendance
         (event_id, student_id, checkin_at, checkout_at, checkin_latitude, checkin_longitude,
          checkin_accuracy_meters, checkin_distance_meters, status, verification_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'qr_gps')`,
      [
        evCompleted.insertId, s.studentId,
        utc(checkinAt),
        checkedOut ? utc(new Date(completedStart.getTime() + 3 * hour - 15 * 60 * 1000)) : null,
        (SCHOOLS_COORDS.lat + (Math.random() - 0.5) * 0.0005).toFixed(7),
        (SCHOOLS_COORDS.lng + (Math.random() - 0.5) * 0.0005).toFixed(7),
        acc, dist,
        checkedOut ? 'checked_out' : late ? 'late' : 'present',
      ]
    );
  }

  // 2. Ongoing event right now (open check-in; QR testable)
  const ongoingStart = new Date(now.getTime() - hour);
  const [evOngoing] = await q(
    `INSERT INTO events
       (title, description, category, venue_name, latitude, longitude,
        radius_meters, max_gps_accuracy_meters, start_at, end_at,
        checkin_opens_at, checkin_closes_at, late_after, checkout_required,
        status, created_by)
     VALUES
       ('Science Fair 2026',
        'Fictional sample event: exhibits and demonstrations. Open to all active students.',
        'Academic', 'School Gymnasium', 14.600050, 120.984610, 75, 50, ?, ?, ?, ?, ?, 1,
        'published', ?)`,
    [
      utc(ongoingStart),
      utc(new Date(now.getTime() + 4 * hour)),
      utc(new Date(now.getTime() - 2 * hour)),
      utc(new Date(now.getTime() + 2 * hour)),
      utc(ongoingStart),
      adminId,
    ]
  );
  // No eligibility rows => open to every active student (documented default).
  await q(
    'INSERT INTO event_assignments (event_id, teacher_id, assigned_by) VALUES (?, ?, ?)',
    [evOngoing.insertId, teacherIds[1], adminId]
  );

  // 3. Upcoming event
  const upcomingStart = new Date(now.getTime() + 3 * day);
  const [evUpcoming] = await q(
    `INSERT INTO events
       (title, description, category, venue_name, latitude, longitude,
        radius_meters, max_gps_accuracy_meters, start_at, end_at,
        checkin_opens_at, checkin_closes_at, late_after, checkout_required,
        status, created_by)
     VALUES
       ('Sports Fest Kickoff Parade',
        'Fictional sample event: opening parade for the annual sports fest. Grade 9 and 10 only.',
        'Sports', 'School Oval', 14.599200, 120.983900, 100, 50, ?, ?, ?, ?, ?, 0,
        'published', ?)`,
    [
      utc(upcomingStart),
      utc(new Date(upcomingStart.getTime() + 2 * hour)),
      utc(new Date(upcomingStart.getTime() - 30 * 60 * 1000)),
      utc(new Date(upcomingStart.getTime() + 20 * 60 * 1000)),
      utc(upcomingStart),
      adminId,
    ]
  );
  await q(
    'INSERT INTO event_eligible_groups (event_id, grade_level_id) VALUES (?, ?), (?, ?)',
    [evUpcoming.insertId, gradeIds[2], evUpcoming.insertId, gradeIds[3]]
  );

  // 4. Draft event (not visible to students)
  await q(
    `INSERT INTO events
       (title, description, category, venue_name, latitude, longitude,
        radius_meters, max_gps_accuracy_meters, start_at, end_at,
        checkin_opens_at, checkin_closes_at, late_after, checkout_required,
        status, created_by)
     VALUES
       ('Recognition Rites (Draft)',
        'Fictional sample event still being prepared.', 'Academic', 'Covered Court',
        14.599800, 120.984100, 50, 50,
        ?, ?, ?, ?, ?, 0, 'draft', ?)`,
    [
      utc(new Date(now.getTime() + 14 * day)),
      utc(new Date(now.getTime() + 14 * day + 2 * hour)),
      utc(new Date(now.getTime() + 14 * day - 30 * 60 * 1000)),
      utc(new Date(now.getTime() + 14 * day + 15 * 60 * 1000)),
      utc(new Date(now.getTime() + 14 * day)),
      adminId,
    ]
  );

  // --- Notifications & preferences -----------------------------------------
  await q(
    `INSERT INTO notifications (user_id, title, message, type)
     VALUES (?, 'Welcome', 'This is a fictional seed environment. Change default passwords before any real use.', 'system')`,
    [adminId]
  );
  for (const s of studentRows.slice(0, 20)) {
    await q(
      `INSERT INTO notifications (user_id, event_id, title, message, type)
       VALUES (?, ?, 'Upcoming Event', 'Science Fair 2026 is open for check-in.', 'reminder')`,
      [s.userId, evOngoing.insertId]
    );
  }
  const [allUsers] = await q('SELECT id FROM users');
  for (const u of allUsers) {
    await q(
      'INSERT INTO notification_preferences (user_id, in_app_enabled, email_enabled, push_enabled) VALUES (?, 1, 0, 0)',
      [u.id]
    );
  }

  await connection.end();

  console.log('[seed] Done. Fictional data inserted:');
  console.log(`        admin: username="${config.seed.adminUsername}" password="${adminPassword}"`);
  if (!config.seed.adminPassword) {
    console.log('        (default dev password - set SEED_ADMIN_PASSWORD in .env for a custom one)');
  }
  console.log('        teachers: username like "e.dolor", password="Teacher@123"');
  console.log('        students: username = student number (e.g. "2026-0001"), password="Student@123"');
  console.log(`        ${studentCounter} students, 4 teachers, 4 events.`);
}

main().catch((err) => {
  console.error('[seed] Failed:', err.message);
  process.exit(1);
});
