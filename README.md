# QR Code + GPS-Based School Event Attendance System

A complete, self-hosted attendance system for junior/senior high school events. Students
check in by scanning a rotating QR code while their GPS position is verified server-side
against the event venue; coordinators monitor attendance live, review flagged submissions,
and export reports. Built with Node.js/Express, MySQL, Bootstrap 5, Socket.IO, and a
service-worker PWA.

All seed data is **fictional**. No real student information is included anywhere in this
repository.

---

## Features

- **Three roles with backend-enforced RBAC** on every protected route and API:
  admin, teacher (coordinator), student. Hiding UI elements is never the authorization
  mechanism — every request re-checks the session role and event access on the server.
- **Dynamic QR codes** — server-issued tokens rotate every 30–60 s (configurable), only
  SHA-256 hashes are stored, expired tokens are purged by a cron job, and admins can
  revoke all tokens for an event instantly.
- **Server-side GPS verification** — browser coordinates are treated as untrusted input.
  Distance is computed with the Haversine formula on the server. Outcomes:
  `verified` (within radius), `flagged` (within radius × flag multiplier → queued for
  coordinator review), or `rejected` (422-style error with a student-friendly message).
  Accuracy ceilings and reading freshness are enforced server-side.
- **Attendance lifecycle** — check-in/check-out, statuses
  (`present / late / checked_out / absent / pending_review / rejected`), idempotent
  submissions (duplicate scans return the original record), UTC storage with local-time
  display, and an automatic absence finalizer that runs after each event's check-in
  window closes (with a grace period) — once, per event.
- **Manual overrides with mandatory reasons** — coordinators can manually check students
  in/out, correct statuses, and approve/reject flagged records. Every change is written
  to `attendance_audit_logs` with old/new values and a required reason (≥ 5 chars).
- **Live dashboard** — Socket.IO rooms are authorized (students never join event rooms;
  teachers only join events they are assigned to). Admin analytics use Chart.js.
- **Reports** — CSV, Excel (ExcelJS), and PDF (PDFKit) exports plus a printable sign-in
  sheet, all guarded against spreadsheet formula injection and served with
  `Cache-Control: no-store`.
- **Notifications** — in-app (Socket.IO + pollable API), optional email via SMTP, and
  optional Web Push (VAPID). Per-user channel preferences; GPS coordinates are never
  included in any notification.
- **PWA** — installable manifest, versioned static-only service worker cache. The worker
  **never** caches `/api/` responses, non-GET requests, or HTML navigations; offline
  navigations get a dedicated offline page. Attendance can never be recorded offline and
  no success receipt is shown without server confirmation.
- **Security hardening** — Helmet (strict CSP with `script-src 'self'`, no inline
  scripts), synchronizer-token CSRF (replaces the deprecated `csurf`), HttpOnly +
  SameSite cookies, bcrypt password hashing, login rate-limiting with lockout, layered
  API rate limits, express-validator on all input, parameterized queries everywhere,
  audit logs for admin actions, and `no-store` on all sensitive responses.

---

## Tech stack

| Layer      | Choice |
|------------|--------|
| Runtime    | Node.js ≥ 20 (CommonJS) |
| Web        | Express 4, EJS server-rendered views, Bootstrap 5 (+ Bootstrap Icons), vanilla JS |
| Database   | MySQL 8 (InnoDB, utf8mb4), mysql2 pool, all DATETIMEs stored in UTC |
| Realtime   | Socket.IO (session-authenticated handshake) |
| QR         | `qrcode` (server rendering), `html5-qrcode` (browser scanning) |
| Charts     | Chart.js (vendored locally) |
| Sessions   | express-session + express-mysql-session (HttpOnly, SameSite=Lax, Secure in production) |
| Security   | helmet, express-rate-limit, express-validator, bcryptjs, custom CSRF middleware |
| Export     | ExcelJS, PDFKit, CSV |
| Email/Push | nodemailer, web-push |
| Jobs       | node-cron (absence finalizer, token purge, event reminders) |
| Tests      | Vitest (+ supertest for the DB integration suite) |

All third-party browser libraries are **vendored locally** under `/vendor/*` — the app
runs fully offline except for its own origin (required by CSP and the service worker).

---

## Requirements (Windows)

1. **Node.js 20 or newer** — <https://nodejs.org> (LTS installer; includes npm).
2. **MySQL 8.x** — easiest on Windows:
   - [MySQL Community Server](https://dev.mysql.com/downloads/installer/) (choose the
     full installer and let it set up the Windows service), **or**
   - Docker Desktop: `docker run -d --name mysql-att -p 3306:3306 -e MYSQL_ROOT_PASSWORD=change-me mysql:8`
3. A modern Chromium/Firefox browser for QR scanning (camera access).
4. Optional: an SMTP account (Gmail App Password or school relay) and VAPID keys for
   web push — both are optional; the app runs fine without them.

---

## Quick start

From the project root in PowerShell or Git Bash:

```bat
:: 1. Install dependencies
npm install

:: 2. Configure environment
copy .env.example .env
::   Edit .env: set DB_USER / DB_PASSWORD for your MySQL install.
::   Leave NODE_ENV=development for local work.

:: 3. Create the schema (also applies/stamps all migrations)
npm run db:init

:: 4. Load fictional demo data (optional but recommended)
npm run db:seed
::   Prints the demo credentials it created (see below).

:: 5. Start the dev server
npm run dev
::   Open http://localhost:3005
```

In production you would instead set `NODE_ENV=production`, `SESSION_SECRET`
(`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`),
`COOKIE_SECURE=true`, and run behind HTTPS with `npm start`.

### Demo accounts (fictional, created by the seed script)

| Role     | Username                  | Password       |
|----------|---------------------------|----------------|
| Admin    | `admin`                   | `Admin@12345` (override with `SEED_ADMIN_PASSWORD` in `.env`) |
| Teacher  | `e.dolor` (and 3 others)  | `Teacher@123`  |
| Student  | `2026-0001` …             | `Student@123`  |

For real deployments use `npm run create-admin` and delete/disable the seeded accounts.

---

## HTTPS, camera, and GPS

Browsers only expose `getUserMedia` (camera) and `geolocation` to **secure contexts**:

- `http://localhost` / `http://127.0.0.1` count as secure — scanning works locally.
- Any other host (LAN IP, server name) **requires HTTPS** or students will see a
  camera/GPS permission error. Terminate TLS at a reverse proxy (nginx/IIS/Caddy) and
  set `TRUST_PROXY` accordingly (e.g. `TRUST_PROXY=loopback`).

---

## npm scripts

| Script                 | Purpose |
|------------------------|---------|
| `npm run dev`          | Start with nodemon (auto-restart on changes) |
| `npm start`            | Start for production |
| `npm test`             | Run the Vitest suite (unit + security always run; the DB integration suite auto-skips unless `TEST_DB_HOST` is set) |
| `npm run db:init`      | Create database + apply `database/schema.sql`, then stamp all shipped migrations |
| `npm run db:migrate`   | Apply pending SQL migrations in `database/migrations/` |
| `npm run db:seed`      | Insert fictional demo data (idempotent-ish: fails if users already exist) |
| `npm run db:reset`     | `db:init` + `db:seed` (drops and recreates everything) |
| `npm run create-admin` | Interactively create an admin user |
| `npm run generate-vapid` | Generate VAPID keys for web push (paste into `.env`) |
| `npm run generate-icons` | Regenerate PWA icons from a source image |

Environment variables are documented inline in `.env.example`.

---

## Running the tests

```bat
npm test
```

- **Unit + security suites** (GPS math, QR payload parsing/token utilities, CSV/Excel
  formula-injection guards, filename sanitization, password policy, bcrypt, production
  environment validation) run everywhere and need no database.
- **Integration suite** (`tests/integration/attendance-flow.test.js`) exercises the real
  HTTP surface with supertest against a real MySQL database: login, CSRF, RBAC,
  QR check-in/check-out with idempotency, GPS rejection, eligibility enforcement,
  teacher review + audit, absence finalizer, token-hash leakage, CSP, cache headers,
  and token expiry. It creates a temporary `<DB_NAME>_test` database, seeds fixtures,
  and drops it afterwards. **It self-skips unless you provide:**

```bat
set TEST_DB_HOST=127.0.0.1
set TEST_DB_USER=root
set TEST_DB_PASSWORD=change-me
:: TEST_DB_PORT / TEST_DB_NAME optional (defaults 3306 / school_attendance)
npm test
```

Never point the integration suite at a database you care about — it creates and drops
`<DB_NAME>_test`.

---

## Production deployment checklist

- [ ] `NODE_ENV=production`, `SESSION_SECRET` set (48+ random bytes), `COOKIE_SECURE=true`
- [ ] HTTPS in front of the app (camera/GPS hard requirement); `TRUST_PROXY` set
- [ ] `npm run db:init` (fresh install) or `npm run db:migrate` (upgrade) — **not** `db:seed`
- [ ] `npm run create-admin`; disable any seeded demo accounts
- [ ] Set `QR_ROTATION_SECONDS`, GPS defaults, and rate limits appropriate to your school
- [ ] Optional: SMTP creds + `npm run generate-vapid` for email/push notifications
- [ ] Run the server under a process manager (PM2, NSSM Windows service, systemd) —
      `npm start` is a plain foreground process
- [ ] Confirm the server clock is correct (freshness checks and UTC storage assume it)

### Deploying to Render + Aiven MySQL

**1. Aiven — create the MySQL service**

1. Aiven console → **Create service** → **MySQL 8**.
2. In **Connection information**, note the host, port, username, and password, and
   download the **CA certificate** (`ca.pem`).
3. In **Databases**, add `school_attendance` (or let `db:init`/`db:migrate` create it).

**2. Initialize the database (run from your machine, never on production data)**

Fill `.env` locally with the Aiven values (`.env` is gitignored — never commit it):

```bat
DB_HOST=<aiven-host>
DB_PORT=<aiven-port>
DB_USER=<aiven-user>
DB_PASSWORD=<aiven-password>
DB_NAME=school_attendance
DB_SSL=true
DB_SSL_CA_PATH=C:\path\to\ca.pem
```

- Fresh service: `npm run db:init` (applies the schema and stamps all migrations),
  then `npm run create-admin`. **Never run `db:seed` in production.**
- Upgrading an existing install: `npm run db:migrate`.
- `db:migrate` **refuses to run migrations containing `DROP TABLE` against a
  non-empty database** (data-loss guard). To rebuild a broken/fresh database use
  `npm run db:init`, which drops and recreates everything.

**3. Render — create the web service**

1. Push the code to GitHub. Verify first: `git status` must not list `.env`
   (it is covered by `.gitignore`). Never commit real credentials.
2. Render → **New +** → **Web Service** → connect the repo.
3. **Build command:** `npm ci`  (uses the lockfile for reproducible builds)
   **Start command:** `npm start`
4. Add environment variables (Render → Environment):

   | Key | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `SESSION_SECRET` | `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` output |
   | `TRUST_PROXY` | `1` (required — Render is one proxy hop; without it Secure cookies are never sent) |
   | `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | from Aiven |
   | `DB_SSL` | `true` |
   | `DB_SSL_CA` | full contents of `ca.pem`, pasted with `\n` for newlines (Render has no file path to use) |

5. **Settings → Health check path:** `/health` (returns `{"ok":true}` when the DB
   pool is reachable; the app also binds `0.0.0.0` and honors `PORT`).
6. Deploy. A healthy boot logs
   `[db] connected to <host>:<port>/school_attendance (TLS)`.

**4. Verify the deployment**

- `GET https://<your-app>.onrender.com/health` → `200 {"ok":true}`
- `GET /login` → `200`; `GET /api/auth/csrf` → `200` with a `csrfToken`
- `POST /api/auth/login` **without** the CSRF token → `403 csrf_failure`
  (proves CSRF enforcement is live)
- Sign in through the browser → dashboard; the session cookie must be
  `Secure; HttpOnly; SameSite=Lax`
- `GET /admin` while logged out → redirect to `/login` (RBAC enforced)

### Backups

- **Database**: `mysqldump --single-transaction --routines school_attendance > backup.sql`
  on a schedule (Windows Task Scheduler / cron). The session store lives in the same
  database, so one dump covers everything.
- **Configuration**: keep `.env` in a secrets manager or an encrypted backup — it is
  excluded from version control by design.
- **Files**: the app is otherwise stateless (no user uploads are persisted beyond the
  temporary Excel import buffer).

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `ECONNREFUSED 127.0.0.1:3306` | MySQL not running. Start the Windows service (`net start mysql80`) or the Docker container. |
| `ER_ACCESS_DENIED_ERROR` | Wrong `DB_USER`/`DB_PASSWORD` in `.env`. |
| `Unknown database 'school_attendance'` | Run `npm run db:init`. |
| Camera never opens on a phone/LAN IP | Not a secure context — serve over HTTPS. |
| GPS always "rejected" | Desktop PCs have poor geolocation. Test on a phone, or widen `GPS_MAX_ACCURACY_METERS` / the event radius. Accuracy and freshness limits are enforced server-side. |
| `Security token invalid or missing` (403) | CSRF token expired with the session — reload the page. Happens after server restarts in development (ephemeral session secret). |
| `csrf_failure` on **every** POST after deploying | The session cookie is never set. Two usual causes: (1) the app is served over plain HTTP in production, so the `Secure` cookie is withheld — serve HTTPS and set `TRUST_PROXY=1`; (2) the session store cannot reach MySQL (e.g. Aiven without TLS) — check the boot log for `[db]` errors and set `DB_SSL=true` + the CA cert. |
| `db:migrate` refuses: "contains DROP TABLE ... non-empty database" | The data-loss guard fired. Intended behavior. To rebuild a database you can afford to wipe, use `npm run db:init`. |
| Email/push notifications never arrive | Check Settings → system settings toggles, per-user notification preferences, and the SMTP/VAPID config logs at startup ("SMTP disabled", "VAPID keys missing"). |
| `SESSION_SECRET must be set` on boot | Required in `NODE_ENV=production`. Generate one as shown above. |
| Port 3000 already in use | Change `PORT` in `.env`. |

---

## Project layout

```
src/
  app.js               Express app factory (security, vendored statics, routers)
  server.js            HTTP + Socket.IO bootstrap, job registration
  config/              environment + settings service (DB-backed overrides)
  middleware/          authentication, authorization (RBAC + event access), CSRF, rate limits
  controllers/         thin HTTP layer; business logic lives in services
  services/            attendance, QR, GPS, reports, notifications, email, push, upload…
  repositories/        SQL access, parameterized queries only
  validators/          express-validator chains
  routes/              page routes (EJS) + /api routes
  jobs/                cron: absence finalizer, token purge, reminders
  sockets/             Socket.IO init + authorized rooms
  utils/               errors, haversine, tokens, time, logger
database/              schema.sql, migrations/, migrate.js, seed.js
public/                css, js, icons, manifest, service worker, offline page
tests/                 unit, security, integration (DB-guarded)
docs/                  API reference
```

## Verified vs. environment-dependent

Per the project's honesty requirements:

- **Verified with a live MySQL-compatible database (MariaDB 10.4)**: the complete
  Vitest suite — **50/50 passing**, including the integration suite (real HTTP flows:
  login/CSRF/RBAC, QR check-in + idempotency, GPS rejection, eligibility enforcement,
  check-out, teacher review + audit trail, absence finalizer, token-hash leakage,
  CSP, cache headers, token expiry). The full stack was also booted and exercised in a
  real browser: admin dashboard with Chart.js, event console, rotating QR screen
  (verified the code image changes each cycle), manual entry, audit API, and
  CSV/XLSX/PDF exports.
- **Requires a camera + HTTPS/localhost + device GPS** to exercise interactively:
  the browser scanning flow (`student-scan.js`). All of its server-side counterparts
  (token validation, GPS verification, status computation) are covered by the
  unit and integration tests.
