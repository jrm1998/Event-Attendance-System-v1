'use strict';

const db = require('../config/database');

async function log({ actorUserId, action, entityType = null, entityId = null, details = null, ipAddress = null }) {
  try {
    await db.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, details, ip_address)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        actorUserId,
        action.slice(0, 100),
        entityType,
        entityId !== null && entityId !== undefined ? String(entityId) : null,
        details ? JSON.stringify(details) : null,
        ipAddress,
      ]
    );
  } catch (err) {
    // Audit logging must never break the main flow, but failures are surfaced.
    require('../utils/logger').error('audit log write failed:', err.message);
  }
}

async function list({ actor, action, entityType, search, limit, offset }) {
  const where = [];
  const params = [];
  if (actor) {
    where.push('l.actor_user_id = ?');
    params.push(actor);
  }
  if (action) {
    where.push('l.action LIKE ?');
    params.push(`%${action}%`);
  }
  if (entityType) {
    where.push('l.entity_type = ?');
    params.push(entityType);
  }
  if (search) {
    where.push('(l.action LIKE ? OR u.username LIKE ? OR l.entity_id LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [countRows] = await db.query(
    `SELECT COUNT(*) AS total FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_user_id ${whereSql}`,
    params
  );
  const [rows] = await db.query(
    `SELECT l.*, u.username AS actor_username
       FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_user_id
       ${whereSql}
       ORDER BY l.created_at DESC, l.id DESC
       LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return { rows, total: countRows[0].total };
}

module.exports = { log, list };
