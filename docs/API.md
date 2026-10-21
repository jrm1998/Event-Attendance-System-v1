# API Reference

All API endpoints live under `/api`. Every state-changing request must present the
session's CSRF token via the `X-CSRF-Token` header (or `_csrf` form field) — see
[Authentication](#authentication). Unless stated otherwise, JSON is returned and all
errors use `{ "error": "<message>", "code": "<machine-code>" }`.

Common error codes:

| Code | Meaning |
|------|---------|
| `validation` | express-validator rejected the input (HTTP 400) |
| `csrf_failure` | missing/invalid CSRF token (HTTP 403) |
| `auth` | not logged in (HTTP 401) |
| `forbidden` | authenticated but role/event access denied (HTTP 403) |
| `not_found` (or 404) | resource missing |
| `conflict` / `already_checked_in` / `already_checked_out` | idempotent duplicates (HTTP 200/409, see attendance) |

Rate limits (defaults, tunable via `.env`): login 10/15 min with lockout after 5
failures, attendance 20/min, general `/api` 300/min.

---

## Authentication

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/auth/session` | none | Current session: `{ authenticated, user: { id, username, role, … } }` |
| GET | `/api/auth/csrf` | none | Returns `{ csrfToken }` for the current session (creates one). Call before the first state-changing request. |
| POST | `/api/auth/login` | CSRF | Body: `{ username, password }`. Sets the `att.sid` HttpOnly session cookie. Locked accounts and rate-limited IPs get 429/423. |
| POST | `/api/auth/logout` | CSRF + session | Destroys the session. |
| POST | `/api/auth/password` | session + CSRF | Body: `{ currentPassword, newPassword }` (policy: ≥ 10 chars, mixed classes). |

### Authentication flow (scripted clients)

```
GET  /api/auth/csrf                      -> { csrfToken }          (cookie jar active)
POST /api/auth/login                     { username, password }    (X-CSRF-Token header)
GET  /api/attendance/mine                (X-CSRF-Token header where applicable)
```

---

## Attendance (student)

| Method | Path | Role | Description |
|--------|------|------|-------------|
| POST | `/api/attendance/check-in` | student | Body: `{ qr, latitude, longitude, accuracy, timestamp }` where `qr` is the raw scanned payload (`ATT:<eventId>:<token>`). Server verifies the rotating token, GPS distance/accuracy/freshness, and eligibility. Returns the confirmed record; the client must never render success without this response. |
| POST | `/api/attendance/check-out` | student | Same body. Guarded update (`checkout_at IS NULL`); idempotent. |
| GET | `/api/attendance/mine` | student | The caller's attendance rows (token hashes are never included). |

**Check-in outcomes**

- `200 { status: "present" | "late", verificationStatus: "qr_gps", … }` — verified.
- `200 { status: "pending_review", … }` — outside radius but inside the flag
  multiplier; queued for coordinator review.
- `400/422 { error }` — rejected (too far, accuracy too low, stale reading, expired
  token, not eligible, outside window).
- Replays of an identical scan return the original record (idempotency).

## Attendance (coordinator — admin or teacher assigned to the event)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/attendance/:id/review` | Body: `{ decision: "approve"|"reject", reason }` (reason ≥ 5 chars). Approve recomputes present/late; reject marks rejected. Audited + student notified. |
| POST | `/api/attendance/:id/checkout` | Body: `{ reason }`. Manual check-out; audited. |
| POST | `/api/attendance/:id/status` | Body: `{ status: "present"|"late"|"absent"|"pending_review"|"rejected", reason }`. Status correction; audited with old/new values. |
| GET | `/api/attendance/:id/audit` | Full audit trail (create/review/edit/checkout events) for one attendance row. |

---

## Events

| Method | Path | Access | Description |
|--------|------|--------|-------------|
| GET | `/api/events` | admin, teacher | List (teachers see their assigned events). Query filters supported. |
| POST | `/api/events` | admin | Create. Body includes title, venue (name/lat/lng), windows (`checkin_opens_at`, `checkin_closes_at`, `start_at`, `end_at`), `radius_meters`, `max_gps_accuracy_meters`, `checkout_required`, eligibility. |
| GET | `/api/events/:id` | admin or assigned teacher | Event detail. |
| PUT | `/api/events/:id` | admin | Update. |
| POST | `/api/events/:id/status/:action` | admin | `action` ∈ `publish`, `cancel`, `complete`, `archive`. |
| GET | `/api/events/:id/eligible-count` | admin, assigned teacher | Number of eligible students. |
| GET | `/api/events/students/search` | admin | Global student search (by name/number/section). |
| GET | `/api/events/:id/students/search` | admin or assigned teacher | Eligible students for this event **without** an attendance row (for manual entry). `?q=` search. |
| GET | `/api/events/:id/attendance` | admin or assigned teacher | Paged attendance rows. `?status=` whitelist filter, `?page=&limit=`. |
| POST | `/api/events/:id/attendance/manual` | admin or assigned teacher | Body: `{ studentId, status: "present"|"late"|"absent", reason }`. Eligibility required; no pre-existing row; audited. |

## QR codes

| Method | Path | Access | Description |
|--------|------|--------|-------------|
| POST | `/api/events/:id/qr/issue` | admin or assigned teacher | Issues a fresh token; returns the payload for rendering (`ATT:<id>:<token>`) and its `expires_at`. Rate-limited. Only SHA-256 hashes are stored. |
| POST | `/api/events/:id/qr/revoke` | admin | Revokes all live tokens for the event (displays everywhere go dark immediately). |

## Reports (CSV / Excel / PDF)

All four return file downloads (`Content-Disposition: attachment`, `Cache-Control:
no-store`). Access: admin or teacher assigned to the event.

| Path | Format |
|------|--------|
| `/api/events/:id/reports/attendance.csv` | CSV (formula-injection guarded) |
| `/api/events/:id/reports/attendance.xlsx` | Excel (frozen header, autofilter, guarded cells) |
| `/api/events/:id/reports/attendance.pdf` | PDF report (landscape, paginated, timezone-stamped) |
| `/api/events/:id/reports/signin-sheet.pdf` | Printable sign-in sheet (eligible roster, blank signature columns) |

---

## Students / users / structure (admin only)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/students/:id` | Student detail. |
| POST | `/api/students` | Create student (+ linked user account). |
| PUT | `/api/students/:id` | Update student. |
| POST | `/api/students/bulk` | Bulk create. |
| POST | `/api/students/import/validate` | Multipart `file` (xlsx/csv): dry-run validation report. |
| POST | `/api/students/import/commit` | Same file: commit valid rows. |
| GET | `/api/students/:id/history` | Attendance history for one student. |
| POST | `/api/users` | Create admin/teacher user. |
| PUT | `/api/users/:id/status` | Activate/suspend/deactivate account. |
| POST | `/api/users/:id/reset-password` | Admin-initiated password reset. |
| GET | `/api/structure` | School years, grade levels, sections tree. |
| POST/PUT | `/api/structure/school-years` (+`/:id/activate`) | Manage school years. |
| POST/PUT | `/api/structure/grade-levels`, `/api/structure/sections` | Manage grades/sections. |

## Dashboard

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/admin/summary` | admin | Live aggregate stats for the admin dashboard (today + all-time counts, recent check-ins). |

---

## Notifications

All require a session (any role).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/notifications` | Paged list for the current user (`?unread=1`, `?page=`). |
| GET | `/api/notifications/unread-count` | `{ count }` for the navbar badge. |
| POST | `/api/notifications/mark-read` | Body: `{ id }` or `{ ids: [...] }`. |
| POST | `/api/notifications/mark-all-read` | Marks everything read. |
| GET | `/api/notifications/preferences` | `{ inApp, email, push }` for the caller. |
| PUT | `/api/notifications/preferences` | Partial update; at least one channel must remain enabled. |
| GET | `/api/push/vapid-public` | VAPID public key (only meaningful when push is configured). |
| POST | `/api/push/subscribe` | Body: a PushSubscription `{ endpoint, keys: { p256dh, auth } }`. |
| POST | `/api/push/unsubscribe` | Body: `{ endpoint }`. |

Notifications never contain GPS coordinates, and email/push fire only when both the
user's preference and the global system setting allow it.

---

## Realtime (Socket.IO)

The client connects with the session cookie (`/socket.io` is authenticated via
express-session during the handshake — unauthenticated sockets are disconnected).

- Every authenticated user joins the private room `user:{id}` → `notification:new`.
- Admins and teachers **assigned** to an event may join `event:{id}`
  (`window.liveSocket.subscribeEvent(id)`) → `attendance:update` with sanitized
  aggregate stats (no coordinates) used by the QR display page and the event console.
- Students can never join event rooms; the server rejects unauthorized subscription
  attempts.

## Caching & security headers

- All `/api/*` and authenticated pages are served with `Cache-Control: no-store` (or
  `no-cache`/`private` where noted) — sensitive data is never cached by browsers or
  shared caches.
- Helmet sets a strict CSP (`script-src 'self'`, no inline script), frame protection,
  and referrer policy. Third-party client libs are vendored under `/vendor/*`.
