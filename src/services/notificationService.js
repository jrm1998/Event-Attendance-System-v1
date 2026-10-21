'use strict';

const db = require('../config/database');
const sockets = require('../sockets');
const settingsService = require('./settingsService');
const emailService = require('./emailService');
const pushService = require('./pushService');
const logger = require('../utils/logger');

/**
 * Notification fan-out: in-app (always, unless user opted out), email and
 * web push (only when the user opted in and the channel is configured).
 * Delivery must never block or fail the caller's request.
 */
async function notifyUser(userId, { title, message, type = 'system', eventId = null }) {
  try {
    const [prefsRows] = await db.query(
      'SELECT in_app_enabled, email_enabled, push_enabled FROM notification_preferences WHERE user_id = ? LIMIT 1',
      [userId]
    );
    const prefs = prefsRows.length
      ? {
          inApp: !!prefsRows[0].in_app_enabled,
          email: !!prefsRows[0].email_enabled,
          push: !!prefsRows[0].push_enabled,
        }
      : { inApp: true, email: false, push: false };

    let notificationId = null;
    if (prefs.inApp) {
      const [result] = await db.query(
        `INSERT INTO notifications (user_id, event_id, title, message, type)
         VALUES (?, ?, ?, ?, ?)`,
        [userId, eventId, title.slice(0, 200), message, type]
      );
      notificationId = result.insertId;
      sockets.emitToUser(userId, 'notification:new', {
        id: notificationId,
        title,
        message,
        type,
        eventId,
        createdAt: new Date().toISOString(),
      });
    }

    if (prefs.email && (await emailEnabled())) {
      const [users] = await db.query('SELECT email FROM users WHERE id = ? LIMIT 1', [userId]);
      const email = users.length ? users[0].email : null;
      if (email) {
        const schoolName = await settingsService.getSchoolName();
        await emailService.sendMail({
          to: email,
          subject: `${title} · ${schoolName}`,
          text: message,
          html: emailService.wrapHtml(title, message, schoolName),
        });
      }
    }

    if (prefs.push && pushService.isConfigured()) {
      await pushService.sendToUser(userId, { title, message: message.slice(0, 300), eventId });
    }

    return notificationId;
  } catch (err) {
    logger.error('notifyUser failed:', err.message);
    return null;
  }
}

async function emailEnabled() {
  const raw = await settingsService.get('notification.email_enabled', 'true');
  return String(raw) !== 'false';
}

async function notifyMany(userIds, payload) {
  for (const id of userIds) {
    await notifyUser(id, payload);
  }
}

module.exports = { notifyUser, notifyMany };
