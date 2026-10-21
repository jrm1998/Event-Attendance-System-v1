'use strict';

const db = require('../config/database');

async function insert(conn, { eventId, tokenHash, issuedAt, expiresAt, createdBy }) {
  const [result] = await conn.query(
    `INSERT INTO qr_tokens (event_id, token_hash, issued_at, expires_at, created_by)
     VALUES (?, ?, ?, ?, ?)`,
    [eventId, tokenHash, issuedAt, expiresAt, createdBy]
  );
  return result.insertId;
}

/** Non-revoked token that matches the hash; caller checks expiry + event. */
async function findByHash(tokenHash) {
  const [rows] = await db.query(
    `SELECT qt.*, e.status AS event_status, e.start_at, e.end_at,
            e.checkin_opens_at, e.checkin_closes_at
       FROM qr_tokens qt JOIN events e ON e.id = qt.event_id
      WHERE qt.token_hash = ? LIMIT 1`,
    [tokenHash]
  );
  return rows[0] || null;
}

async function revokeForEvent(eventId) {
  const [result] = await db.query(
    'UPDATE qr_tokens SET revoked_at = UTC_TIMESTAMP() WHERE event_id = ? AND revoked_at IS NULL',
    [eventId]
  );
  return result.affectedRows;
}

async function countActiveForEvent(eventId) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS c FROM qr_tokens
      WHERE event_id = ? AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP()`,
    [eventId]
  );
  return rows[0].c;
}

/** Housekeeping: delete expired tokens older than 24h. */
async function purgeExpired() {
  const [result] = await db.query(
    'DELETE FROM qr_tokens WHERE expires_at < UTC_TIMESTAMP() - INTERVAL 24 HOUR'
  );
  return result.affectedRows;
}

module.exports = { insert, findByHash, revokeForEvent, countActiveForEvent, purgeExpired };
