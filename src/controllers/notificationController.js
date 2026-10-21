'use strict';

const notificationRepo = require('../repositories/notificationRepo');
const pushService = require('../services/pushService');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/errors');
const { parsePagination } = require('../utils/pagination');
const { validationResult } = require('express-validator');

function validate(req) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw ApiError.badRequest(errors.array({ onlyFirstError: true })[0].msg);
  }
}

const listApi = asyncHandler(async (req, res) => {
  const { page, limit, offset } = parsePagination(req, 20);
  const unreadOnly = req.query.unread === '1';
  const { rows, total } = await notificationRepo.listForUser(req.user.id, { limit, offset, unreadOnly });
  res.json({
    rows: rows.map((n) => ({
      id: n.id,
      title: n.title,
      message: n.message,
      type: n.type,
      eventId: n.event_id,
      eventTitle: n.event_title,
      read: !!n.read_at,
      createdAt: n.created_at,
    })),
    total,
    page,
    limit,
  });
});

const unreadCountApi = asyncHandler(async (req, res) => {
  res.json({ count: await notificationRepo.unreadCount(req.user.id) });
});

const markReadApi = [
  asyncHandler(async (req, res) => {
    const id = Number.parseInt(req.body.id, 10);
    if (!Number.isInteger(id) || id <= 0) throw ApiError.badRequest('Invalid notification id.');
    await notificationRepo.markRead(req.user.id, id);
    res.json({ ok: true });
  }),
];

const markAllReadApi = asyncHandler(async (req, res) => {
  const updated = await notificationRepo.markAllRead(req.user.id);
  res.json({ ok: true, updated });
});

const preferencesApi = asyncHandler(async (req, res) => {
  res.json(await notificationRepo.getPreferences(req.user.id));
});

const updatePreferencesApi = [
  asyncHandler(async (req, res) => {
    const prefs = {
      inApp: req.body.inApp === undefined ? undefined : !!req.body.inApp,
      email: req.body.email === undefined ? undefined : !!req.body.email,
      push: req.body.push === undefined ? undefined : !!req.body.push,
    };
    if (prefs.inApp === undefined || prefs.email === undefined || prefs.push === undefined) {
      const current = await notificationRepo.getPreferences(req.user.id);
      Object.keys(prefs).forEach((k) => {
        if (prefs[k] === undefined) prefs[k] = current[k];
      });
    }
    if (!prefs.inApp && !prefs.email && !prefs.push) {
      throw ApiError.badRequest('At least one notification channel must stay enabled.');
    }
    await notificationRepo.setPreferences(req.user.id, prefs);
    res.json({ ok: true, preferences: prefs });
  }),
];

const vapidPublicApi = asyncHandler(async (req, res) => {
  res.json({ publicKey: pushService.publicKey(), configured: pushService.isConfigured() });
});

const subscribeApi = asyncHandler(async (req, res) => {
  if (!pushService.isConfigured()) {
    throw ApiError.badRequest('Push notifications are not configured on this server.');
  }
  const sub = req.body && req.body.subscription;
  const keys = sub && sub.keys;
  if (!sub || !sub.endpoint || !keys || !keys.p256dh || !keys.auth) {
    throw ApiError.badRequest('A valid push subscription is required.');
  }
  await notificationRepo.upsertSubscription(req.user.id, {
    endpoint: sub.endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
    userAgent: req.headers['user-agent'],
  });
  res.json({ ok: true });
});

const unsubscribeApi = asyncHandler(async (req, res) => {
  const endpoint = req.body && req.body.endpoint;
  if (!endpoint) throw ApiError.badRequest('An endpoint is required.');
  await notificationRepo.revokeSubscription(req.user.id, endpoint);
  res.json({ ok: true });
});

/** Unified notifications page (all roles). */
async function notificationsPage(req, res) {
  const [preferences, { rows: initial, total }] = await Promise.all([
    notificationRepo.getPreferences(req.user.id),
    notificationRepo.listForUser(req.user.id, { limit: 20, offset: 0 }),
  ]);
  res.render('notifications', {
    title: 'Notifications',
    initial,
    total,
    preferences,
    pushAvailable: pushService.isConfigured(),
  });
}

module.exports = {
  listApi,
  unreadCountApi,
  markReadApi,
  markAllReadApi,
  preferencesApi,
  updatePreferencesApi,
  vapidPublicApi,
  subscribeApi,
  unsubscribeApi,
  notificationsPage,
};
