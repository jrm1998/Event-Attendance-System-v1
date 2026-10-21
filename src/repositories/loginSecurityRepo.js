'use strict';

const db = require('../config/database');

async function logAttempt({ userId = null, username, ipAddress, userAgent, outcome }) {
  await db.query(
    `INSERT INTO login_security_logs (user_id, username_attempted, ip_address, user_agent, outcome)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, username.slice(0, 100), ipAddress, userAgent ? String(userAgent).slice(0, 255) : null, outcome]
  );
}

/** Failed attempts for a username within the last N minutes. */
async function countUsernameFailures(username, sinceMinutes) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS c FROM login_security_logs
      WHERE outcome = 'failed' AND username_attempted = ?
        AND created_at > UTC_TIMESTAMP() - INTERVAL ? MINUTE`,
    [username, sinceMinutes]
  );
  return rows[0].c;
}

/** Failed attempts for an IP address within the last N minutes. */
async function countIpFailures(ipAddress, sinceMinutes) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS c FROM login_security_logs
      WHERE outcome = 'failed' AND ip_address = ?
        AND created_at > UTC_TIMESTAMP() - INTERVAL ? MINUTE`,
    [ipAddress, sinceMinutes]
  );
  return rows[0].c;
}

async function listRecent({ limit = 100, offset = 0, search } = {}) {
  const params = [];
  let where = '';
  if (search) {
    where = 'WHERE username_attempted LIKE ? OR ip_address LIKE ?';
    params.push(`%${search}%`, `%${search}%`);
  }
  const [rows] = await db.query(
    `SELECT l.*, u.username FROM login_security_logs l
       LEFT JOIN users u ON u.id = l.user_id
       ${where}
       ORDER BY l.created_at DESC, l.id DESC
       LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return rows;
}

module.exports = { logAttempt, countUsernameFailures, countIpFailures, listRecent };
