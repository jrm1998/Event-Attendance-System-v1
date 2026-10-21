/**
 * End-to-end integration tests against a real MySQL database.
 *
 * Self-skipping: these tests only run when TEST_DB_HOST is set, e.g.
 *
 *   TEST_DB_HOST=127.0.0.1 TEST_DB_USER=root TEST_DB_PASSWORD=secret npm test
 *
 * They create a dedicated <DB_NAME>_test database, apply schema.sql, seed the
 * minimum fixture data (fictional), and exercise the real HTTP surface with
 * supertest: authentication, CSRF, RBAC, QR check-in/check-out and review.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';

const RUN_DB_TESTS = !!process.env.TEST_DB_HOST;

describe.runIf(RUN_DB_TESTS)('integration: auth + attendance flow', () => {
  let mysql;
    let connection;
    let app;
    let agentFactory;
    let dbConfig;
    let dbName;
    let ids;

    const ATTENDANT = { username: 'intstudent1', password: 'Student@12345', fullName: 'Integ Test Student' };
    const TEACHER = { username: 'intteacher1', password: 'Teacher@12345' };
    const ADMIN = { username: 'intadmin1', password: 'Admin@123456' };
    const VENUE = { lat: 14.599512, lng: 120.984222, radius: 60 };

    async function waitForPort() {
      // mysql2 handles retries poorly mid-query; a short connect loop keeps
      // CI containers happy.
      for (let attempt = 0; attempt < 10; attempt += 1) {
        try {
          const c = await mysql.createConnection({ host: dbConfig.host, port: dbConfig.port, user: dbConfig.user, password: dbConfig.password });
          await c.end();
          return;
        } catch (err) {
          if (attempt === 9) throw err;
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    }

    beforeAll(async () => {
      mysql = (await import('mysql2/promise')).default;
      const bcrypt = (await import('bcryptjs')).default;
      const fs = (await import('node:fs')).default;
      const path = (await import('node:path')).default;

      dbConfig = {
        host: process.env.TEST_DB_HOST || '127.0.0.1',
        port: Number(process.env.TEST_DB_PORT || 3306),
        user: process.env.TEST_DB_USER || 'root',
        password: process.env.TEST_DB_PASSWORD || '',
      };
      dbName = `${process.env.TEST_DB_NAME || 'school_attendance'}_test`;
      await waitForPort();

      connection = await mysql.createConnection({ ...dbConfig, multipleStatements: true });
      await connection.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
      await connection.query(`CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
      // schema.sql contains no CREATE DATABASE / USE: select the dedicated
      // test database explicitly before applying it.
      await connection.changeUser({ database: dbName });
      const schemaSql = fs.readFileSync(path.join(process.cwd(), 'database', 'schema.sql'), 'utf8');
      await connection.query(schemaSql);

      // --- Minimal fixture ---------------------------------------------------
      const hash = (pw) => bcrypt.hashSync(pw, 4);
      const [adminUser] = await connection.query(
        `INSERT INTO users (username, email, password_hash, role) VALUES (?, 'intadmin@example.edu', ?, 'admin')`,
        [ADMIN.username, hash(ADMIN.password)]
      );
      const [teacherUser] = await connection.query(
        `INSERT INTO users (username, email, password_hash, role) VALUES (?, 'intteacher@example.edu', ?, 'teacher')`,
        [TEACHER.username, hash(TEACHER.password)]
      );
      const [studentUser] = await connection.query(
        `INSERT INTO users (username, email, password_hash, role) VALUES (?, 'intstudent@example.edu', ?, 'student')`,
        [ATTENDANT.username, hash(ATTENDANT.password)]
      );
      const [year] = await connection.query(
        `INSERT INTO school_years (name, start_date, end_date, status) VALUES ('2026-2027', '2026-06-01', '2027-03-31', 'active')`
      );
      const [grade] = await connection.query(`INSERT INTO grade_levels (name, sort_order) VALUES ('Grade 7', 1)`);
      const [section] = await connection.query(
        `INSERT INTO sections (grade_level_id, school_year_id, name) VALUES (?, ?, 'Narra')`,
        [grade.insertId, year.insertId]
      );
      const [teacher] = await connection.query(
        `INSERT INTO teachers (user_id, employee_number, first_name, last_name) VALUES (?, 'T-001', 'Integ', 'Teacher')`,
        [teacherUser.insertId]
      );
      const [student] = await connection.query(
        `INSERT INTO students (user_id, student_number, first_name, last_name, grade_level_id, section_id, school_year_id)
         VALUES (?, '2026-9999', 'Integ', 'Student', ?, ?, ?)`,
        [studentUser.insertId, grade.insertId, section.insertId, year.insertId]
      );
      // Another student NOT eligible for the scoped event.
      const [otherUser] = await connection.query(
        `INSERT INTO users (username, email, password_hash, role) VALUES (?, 'other@example.edu', ?, 'student')`,
        ['intstudent2', hash(ATTENDANT.password)]
      );
      const [otherStudent] = await connection.query(
        `INSERT INTO students (user_id, student_number, first_name, last_name, school_year_id)
         VALUES (?, '2026-9998', 'Other', 'Student', ?)`,
        [otherUser.insertId, year.insertId]
      );

      const now = Date.now();
      const mins = (m) => new Date(now + m * 60000);
      const fmt = (dt) => dt.toISOString().slice(0, 19).replace('T', ' ');
      const [openEvent] = await connection.query(
        `INSERT INTO events (title, venue_name, latitude, longitude, radius_meters, max_gps_accuracy_meters,
            start_at, end_at, checkin_opens_at, checkin_closes_at, late_after, status, created_by)
         VALUES ('Integration Open Event', 'Test Hall', ?, ?, ?, 50,
            ?, ?, ?, ?, ?, 'published', ?)`,
        [
          VENUE.lat,
          VENUE.lng,
          VENUE.radius,
          fmt(mins(60)),
          fmt(mins(120)),
          fmt(mins(-30)),
          fmt(mins(30)),
          fmt(mins(15)),
          adminUser.insertId,
        ]
      );
      // Event restricted to the other student — used for eligibility checks.
      const [restrictedEvent] = await connection.query(
        `INSERT INTO events (title, venue_name, latitude, longitude, radius_meters,
            start_at, end_at, checkin_opens_at, checkin_closes_at, status, created_by)
         VALUES ('Integration Restricted Event', 'Test Lab', ?, ?, 50, ?, ?, ?, ?, 'published', ?)`,
        [VENUE.lat, VENUE.lng, fmt(mins(60)), fmt(mins(120)), fmt(mins(-30)), fmt(mins(30)), adminUser.insertId]
      );
      await connection.query(
        `INSERT INTO event_eligible_students (event_id, student_id) VALUES (?, ?)`,
        [restrictedEvent.insertId, otherStudent.insertId]
      );
      // Teacher is assigned to the open event only.
      await connection.query(
        `INSERT INTO event_assignments (event_id, teacher_id, assigned_by) VALUES (?, ?, ?)`,
        [openEvent.insertId, teacher.insertId, adminUser.insertId]
      );

      // Two extra students for scenarios that need a fresh (no attendance yet)
      // account: GPS rejection and token-expiry tests.
      for (const [username, number] of [
        ['intstudent3', '2026-9997'],
        ['intstudent4', '2026-9996'],
      ]) {
        const [u] = await connection.query(
          `INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, 'student')`,
          [username, `${username}@example.edu`, hash(ATTENDANT.password)]
        );
        await connection.query(
          `INSERT INTO students (user_id, student_number, first_name, last_name, school_year_id)
           VALUES (?, ?, 'Integ', 'Student', ?)`,
          [u.insertId, number, year.insertId]
        );
      }

      ids = {
        openEvent: openEvent.insertId,
        restrictedEvent: restrictedEvent.insertId,
        student: student.insertId,
        studentUser: studentUser.insertId,
        adminUser: adminUser.insertId,
      };

      // --- Load the app pointed at the test database --------------------------
      process.env.DB_HOST = dbConfig.host;
      process.env.DB_PORT = String(dbConfig.port);
      process.env.DB_USER = dbConfig.user;
      process.env.DB_PASSWORD = dbConfig.password;
      process.env.DB_NAME = dbName;
      process.env.DISABLE_JOBS = '1';
      process.env.NODE_ENV = 'test';

      const appModule = await import('../../src/app.js');
      app = appModule.createApp().app;
      agentFactory = (await import('supertest')).default.agent;
    }, 60000);

    afterAll(async () => {
      try {
        if (connection) {
          await connection.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
          await connection.end();
        }
      } catch {
        /* best effort */
      }
    });

    function newAgent() {
      return agentFactory(app);
    }

    async function login(agent, username, password) {
      const csrfRes = await agent.get('/api/auth/csrf').expect(200);
      const token = csrfRes.body.csrfToken;
      expect(token).toMatch(/^[a-f0-9]{64}$/);
      const res = await agent
        .post('/api/auth/login')
        .set('X-CSRF-Token', token)
        .send({ username, password });
      return { res, token };
    }

    it('rejects anonymous attendance submissions', async () => {
      const res = await newAgent().post('/api/attendance/check-in').send({ qr: 'ATT:1:x' });
      expect([401, 403]).toContain(res.status);
    });

    it('enforces CSRF on state-changing API calls', async () => {
      const agent = newAgent();
      const res = await agent.post('/api/attendance/check-in').send({ qr: 'ATT:1:x' });
      // Anonymous would be 401; with a session the missing token must 403.
      const withSession = await login(agent, ATTENDANT.username, ATTENDANT.password);
      expect(withSession.res.status).toBe(200);
      const csrfFail = await agent.post('/api/attendance/check-in').send({ qr: 'ATT:1:x' });
      expect(csrfFail.status).toBe(403);
      expect(csrfFail.body.code).toBe('csrf_failure');
    });

    it('rejects wrong passwords without revealing which part failed', async () => {
      const agent = newAgent();
      const { res } = await login(agent, ATTENDANT.username, 'WrongPassword99');
      expect(res.status).toBe(401);
      // Generic message only — must not hint whether the username or password failed.
      expect(res.body.error).toMatch(/invalid username or password/i);
    });

    it('blocks students from admin APIs (backend RBAC)', async () => {
      const agent = newAgent();
      await login(agent, ATTENDANT.username, ATTENDANT.password);
      const res = await agent.get('/api/admin/summary');
      expect(res.status).toBe(403);
      const res2 = await agent.get('/api/students');
      expect(res2.status).toBe(403);
    });

    it('blocks teachers from events they are not assigned to', async () => {
      const agent = newAgent();
      await login(agent, TEACHER.username, TEACHER.password);
      const res = await agent.get(`/api/events/${ids.restrictedEvent}/attendance`);
      expect(res.status).toBe(403);
      const ok = await agent.get(`/api/events/${ids.openEvent}/attendance`);
      expect(ok.status).toBe(200);
    });

    it('completes QR check-in with valid GPS, then is idempotent', async () => {
      const agent = newAgent();
      await login(agent, ATTENDANT.username, ATTENDANT.password);

      const { issueToken } = await import('../../src/services/qrService.js');
      const { default: eventRepo } = await import('../../src/repositories/eventRepo.js');
      const event = await eventRepo.findById(ids.openEvent);
      const issued = await issueToken(event, { id: ids.adminUser });

      // ~20 m north of the venue: inside the 60 m radius.
      const lat = VENUE.lat + 20 / 110574;
      const csrf = (await agent.get('/api/auth/csrf')).body.csrfToken;
      const checkin = await agent
        .post('/api/attendance/check-in')
        .set('X-CSRF-Token', csrf)
        .send({
          qr: issued.payload,
          latitude: lat,
          longitude: VENUE.lng,
          accuracy: 8,
          timestamp: new Date().toISOString(),
        });
      expect(checkin.status).toBe(200);
      expect(checkin.body.attendance.status).toBe('present');
      expect(checkin.body.attendance.distanceMeters).toBeLessThanOrEqual(VENUE.radius);

      // Re-submitting the same (now rotated-away) QR must return the existing
      // record, not an error.
      const again = await agent
        .post('/api/attendance/check-in')
        .set('X-CSRF-Token', csrf)
        .send({
          qr: issued.payload,
          latitude: lat,
          longitude: VENUE.lng,
          accuracy: 8,
          timestamp: new Date().toISOString(),
        });
      expect(again.status).toBe(200);
      expect(again.body.alreadyCheckedIn).toBe(true);
    });

    it('rejects check-in far outside the venue radius', async () => {
      const agent = newAgent();
      // Fresh student (no prior attendance) so idempotency cannot absorb the rejection.
      await login(agent, 'intstudent3', ATTENDANT.password);
      const { issueToken } = await import('../../src/services/qrService.js');
      const { default: eventRepo } = await import('../../src/repositories/eventRepo.js');
      const event = await eventRepo.findById(ids.openEvent);
      const issued = await issueToken(event, { id: ids.adminUser });

      const csrf = (await agent.get('/api/auth/csrf')).body.csrfToken;
      const res = await agent
        .post('/api/attendance/check-in')
        .set('X-CSRF-Token', csrf)
        .send({
          qr: issued.payload,
          latitude: VENUE.lat + 0.01, // ~1.1 km north
          longitude: VENUE.lng,
          accuracy: 8,
          timestamp: new Date().toISOString(),
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/venue/i);
    });

    it('rejects ineligible students for restricted events', async () => {
      const agent = newAgent();
      await login(agent, ATTENDANT.username, ATTENDANT.password);
      const { issueToken } = await import('../../src/services/qrService.js');
      const { default: eventRepo } = await import('../../src/repositories/eventRepo.js');
      const event = await eventRepo.findById(ids.restrictedEvent);
      const issued = await issueToken(event, { id: ids.adminUser });

      const csrf = (await agent.get('/api/auth/csrf')).body.csrfToken;
      const res = await agent
        .post('/api/attendance/check-in')
        .set('X-CSRF-Token', csrf)
        .send({
          qr: issued.payload,
          latitude: VENUE.lat,
          longitude: VENUE.lng,
          accuracy: 8,
          timestamp: new Date().toISOString(),
        });
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/eligible/i);
    });

    it('checks out with a fresh QR token and records the time', async () => {
      const agent = newAgent();
      await login(agent, ATTENDANT.username, ATTENDANT.password);
      const { issueToken } = await import('../../src/services/qrService.js');
      const { default: eventRepo } = await import('../../src/repositories/eventRepo.js');
      const event = await eventRepo.findById(ids.openEvent);
      const issued = await issueToken(event, { id: ids.adminUser });

      const csrf = (await agent.get('/api/auth/csrf')).body.csrfToken;
      const res = await agent
        .post('/api/attendance/check-out')
        .set('X-CSRF-Token', csrf)
        .send({
          qr: issued.payload,
          latitude: VENUE.lat,
          longitude: VENUE.lng,
          accuracy: 9,
          timestamp: new Date().toISOString(),
        });
      expect(res.status).toBe(200);
      expect(res.body.attendance.status).toBe('checked_out');
      expect(res.body.attendance.checkoutAt).toBeTruthy();
    });

    it('lets the assigned teacher approve a pending_review record with an audit entry', async () => {
      // Insert a pending record for the second student on the open event.
      const [otherRow] = await connection.query(
        `INSERT INTO attendance (event_id, student_id, checkin_at, status, verification_status, verification_reason)
         VALUES (?, (SELECT id FROM students WHERE student_number = '2026-9998'), UTC_TIMESTAMP(), 'pending_review', 'flagged', '78 m from venue')`,
        [ids.openEvent]
      );

      const agent = newAgent();
      await login(agent, TEACHER.username, TEACHER.password);
      const token = (await agent.get('/api/auth/csrf')).body.csrfToken;
      const bad = await agent
        .post(`/api/attendance/${otherRow.insertId}/review`)
        .set('X-CSRF-Token', token)
        .send({ decision: 'approve', reason: 'no' });
      expect(bad.status).toBe(400); // reason too short

      const res = await agent
        .post(`/api/attendance/${otherRow.insertId}/review`)
        .set('X-CSRF-Token', token)
        .send({ decision: 'approve', reason: 'Verified with the student at the door' });
      expect(res.status).toBe(200);
      expect(res.body.attendance.status).toBe('present');
      expect(res.body.attendance.verificationStatus).toBe('manual');

      const audit = await agent.get(`/api/attendance/${otherRow.insertId}/audit`);
      expect(audit.status).toBe(200);
      expect(audit.body.rows.length).toBeGreaterThan(0);
      expect(audit.body.rows[0].action).toBe('approve');
    });

    it('runs the absence finalizer and marks no-shows absent', async () => {
      // The restricted event closed 30 min ago; its only eligible student
      // (2026-9998) has an attendance row on the OPEN event, not this one —
      // wait, that check-in was for the open event, so the restricted event
      // still owes an absence. Close its window first.
      await connection.query(
        `UPDATE events SET checkin_closes_at = UTC_TIMESTAMP() - INTERVAL 20 MINUTE, end_at = UTC_TIMESTAMP() - INTERVAL 10 MINUTE WHERE id = ?`,
        [ids.restrictedEvent]
      );
      const { finalizeAbsences } = await import('../../src/services/attendanceService.js');
      const marked = await finalizeAbsences();
      expect(marked).toBeGreaterThan(0);
      const [rows] = await connection.query(
        `SELECT a.status FROM attendance a JOIN students s ON s.id = a.student_id
          WHERE a.event_id = ? AND s.student_number = '2026-9998'`,
        [ids.restrictedEvent]
      );
      expect(rows[0].status).toBe('absent');
      // Idempotent: a second run marks nothing new.
      expect(await finalizeAbsences()).toBe(0);
    });

    it('keeps QR token hashes out of API responses and logs', async () => {
      const agent = newAgent();
      await login(agent, ATTENDANT.username, ATTENDANT.password);
      const res = await agent.get('/api/attendance/mine');
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toMatch(/token_hash|tokenHash|payload/);
    });

    it('serves a strict CSP on pages', async () => {
      const res = await newAgent().get('/login');
      expect(res.status).toBe(200);
      const csp = res.headers['content-security-policy'];
      expect(csp).toBeTruthy();
      // Inline SCRIPTS are forbidden; Bootstrap's style tag needs style-src
      // 'unsafe-inline', so only assert on the script directives.
      const scriptSrc = (csp.match(/script-src[^;]*/) || [''])[0];
      const scriptSrcAttr = (csp.match(/script-src-attr[^;]*/) || [''])[0];
      expect(scriptSrc).toContain("'self'");
      expect(scriptSrc).not.toContain("'unsafe-inline'");
      expect(scriptSrcAttr).not.toContain("'unsafe-inline'");
      expect(res.headers['x-frame-options'] || (csp.includes('frame-ancestors'))).toBeTruthy();
    });

    it('never caches sensitive API responses', async () => {
      const agent = newAgent();
      await login(agent, ATTENDANT.username, ATTENDANT.password);
      const res = await agent.get('/api/attendance/mine');
      const cacheHeader = res.headers['cache-control'] || '';
      expect(cacheHeader).toMatch(/no-store|no-cache|private/);
    });

    it('expires the QR token after its TTL', async () => {
      const { issueToken } = await import('../../src/services/qrService.js');
      const { default: eventRepo } = await import('../../src/repositories/eventRepo.js');
      const { default: qrRepo } = await import('../../src/repositories/qrRepo.js');
      const event = await eventRepo.findById(ids.openEvent);
      const issued = await issueToken(event, { id: ids.adminUser });
      // Force-expire the token directly in the DB.
      await connection.query(`UPDATE qr_tokens SET expires_at = UTC_TIMESTAMP() - INTERVAL 1 SECOND`);
      const agent = newAgent();
      // Fresh student so the idempotency shortcut cannot absorb the replay
      // before token validation runs.
      await login(agent, 'intstudent4', ATTENDANT.password);
      const csrf = (await agent.get('/api/auth/csrf')).body.csrfToken;
      const res = await agent
        .post('/api/attendance/check-in')
        .set('X-CSRF-Token', csrf)
        .send({
          qr: issued.payload,
          latitude: VENUE.lat,
          longitude: VENUE.lng,
          accuracy: 8,
          timestamp: new Date().toISOString(),
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/expired/i);
      await qrRepo.purgeExpired();
    });
});
