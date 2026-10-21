'use strict';

const db = require('../config/database');

async function listForUser(userId, { limit, offset, unreadOnly = false }) {
  const where = 'n.user_id = ?' + (unreadOnly ? ' AND n.read_at IS NULL' : '');
  const [countRows] = await db.query(
    `SELECT COUNT(*) AS total FROM notifications n WHERE ${where}`,
    [userId]
  );
  const [rows] = await db.query(
    `SELECT n.id, n.event_id, n.title, n.message, n.type, n.read_at, n.created_at,
            e.title AS event_title
       FROM notifications n
       LEFT JOIN events e ON e.id = n.event_id
      WHERE ${where}
      ORDER BY n.created_at DESC, n.id DESC
      LIMIT ? OFFSET ?`,
    [userId, limit, offset]
  );
  return { rows, total: countRows[0].total };
}

async function unreadCount(userId) {
  const [rows] = await db.query(
    'SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL',
    [userId]
  );
  return rows[0].c;
}

async function markRead(userId, notificationId) {
  const [result] = await db.query(
    'UPDATE notifications SET read_at = UTC_TIMESTAMP() WHERE id = ? AND user_id = ? AND read_at IS NULL',
    [notificationId, userId]
  );
  return result.affectedRows;
}

async function markAllRead(userId) {
  const [result] = await db.query(
    'UPDATE notifications SET read_at = UTC_TIMESTAMP() WHERE user_id = ? AND read_at IS NULL',
    [userId]
  );
  return result.affectedRows;
}

async function getPreferences(userId) {
  const [rows] = await db.query(
    'SELECT in_app_enabled, email_enabled, push_enabled FROM notification_preferences WHERE user_id = ? LIMIT 1',
    [userId]
  );
  if (rows.length) {
    return {
      inApp: !!rows[0].in_app_enabled,
      email: !!rows[0].email_enabled,
      push: !!rows[0].push_enabled,
    };
  }
  return { inApp: true, email: false, push: false };
}

async function setPreferences(userId, { inApp, email, push }) {
  await db.query(
    `INSERT INTO notification_preferences (user_id, in_app_enabled, email_enabled, push_enabled)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       in_app_enabled = VALUES(in_app_enabled),
       email_enabled = VALUES(email_enabled),
       push_enabled = VALUES(push_enabled)`,
    [userId, inApp ? 1 : 0, email ? 1 : 0, push ? 1 : 0]
  );
}

// --- Web-push subscriptions ----------------------------------------------------

async function upsertSubscription(userId, { endpoint, p256dh, auth, userAgent }) {
  await db.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, last_used_at)
     VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE
       user_id = VALUES(user_id),
       p256dh = VALUES(p256dh),
       auth = VALUES(auth),
       user_agent = VALUES(user_agent),
       revoked_at = NULL,
       last_used_at = UTC_TIMESTAMP()`,
    [userId, endpoint.slice(0, 500), p256dh.slice(0, 255), auth.slice(0, 255), userAgent ? userAgent.slice(0, 255) : null]
  );
}

async function revokeSubscription(userId, endpoint) {
  const [result] = await db.query(
    'UPDATE push_subscriptions SET revoked_at = UTC_TIMESTAMP() WHERE user_id = ? AND endpoint = ?',
    [userId, endpoint]
  );
  return result.affectedRows;
}

async function revokeAllSubscriptions(userId) {
  const [result] = await db.query(
    'UPDATE push_subscriptions SET revoked_at = UTC_TIMESTAMP() WHERE user_id = ? AND revoked_at IS NULL',
    [userId]
  );
  return result.affectedRows;
}

async function listActiveSubscriptions(userId) {
  const [rows] = await db.query(
    'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ? AND revoked_at IS NULL',
    [userId]
  );
  return rows;
}

module.exports = {
  listForUser,
  unreadCount,
  markRead,
  markAllRead,
  getPreferences,
  setPreferences,
  upsertSubscription,
  revokeSubscription,
  revokeAllSubscriptions,
  listActiveSubscriptions,
};
