'use strict';

const settingsService = require('../services/settingsService');
const auditRepo = require('../repositories/auditRepo');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/errors');

const EDITABLE = [
  { key: 'site.name', label: 'School name', type: 'text', help: 'Shown in the navbar, page titles, emails and report headers.' },
  { key: 'site.timezone', label: 'Timezone (IANA)', type: 'text', help: 'e.g. Asia/Manila. Affects display only; storage is always UTC.' },
  { key: 'qr.rotation_seconds', label: 'QR rotation (seconds)', type: 'number', min: 15, max: 300, help: 'How often the displayed QR code rotates.' },
  { key: 'gps.default_radius_meters', label: 'Default GPS radius (m)', type: 'number', min: 10, max: 10000, help: 'Applied to new events.' },
  { key: 'gps.max_accuracy_meters', label: 'Max GPS accuracy error (m)', type: 'number', min: 5, max: 1000, help: 'Readings less accurate than this are rejected.' },
  { key: 'gps.freshness_seconds', label: 'GPS freshness (seconds)', type: 'number', min: 5, max: 600, help: 'Maximum age of a location reading at submission.' },
  { key: 'gps.flag_distance_multiplier', label: 'Flag distance multiplier', type: 'number', min: 1, max: 5, step: '0.1', help: 'Distance within radius × this is flagged for review instead of rejected outright beyond it.' },
  { key: 'attendance.absent_grace_minutes', label: 'Absence grace (minutes)', type: 'number', min: 0, max: 240, help: 'How long after check-in closes the absence finalizer runs.' },
  { key: 'notification.reminder_hours_before', label: 'Reminder hours before event', type: 'number', min: 1, max: 168 },
  { key: 'notification.email_enabled', label: 'Email notifications enabled', type: 'bool', help: 'Global switch; users must also opt in.' },
  { key: 'notification.push_enabled', label: 'Web push enabled', type: 'bool', help: 'Global switch; requires VAPID keys.' },
];

const settingsPage = asyncHandler(async (req, res) => {
  const all = await settingsService.getAll(true);
  const values = EDITABLE.map((f) => ({ ...f, value: all[f.key] !== undefined ? all[f.key] : '' }));
  res.render('admin/settings', { title: 'System Settings', fields: values, saved: req.query.saved === '1' });
});

const updateSettings = asyncHandler(async (req, res) => {
  const updates = [];
  for (const field of EDITABLE) {
    if (!(field.key in req.body)) {
      // Unchecked HTML checkboxes are omitted from the payload; that is a
      // deliberate "off", not a missing field.
      if (field.type === 'bool') updates.push({ key: field.key, value: 'false' });
      continue;
    }
    let raw = String(req.body[field.key]).trim();
    if (field.type === 'bool') {
      raw = raw === 'on' || raw === 'true' ? 'true' : 'false';
    } else if (field.type === 'number') {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw ApiError.badRequest(`${field.label} must be a number.`);
      if (n < field.min || n > field.max) {
        throw ApiError.badRequest(`${field.label} must be between ${field.min} and ${field.max}.`);
      }
      raw = String(n);
    } else if (field.key === 'site.timezone') {
      const timeUtils = require('../utils/time');
      if (!timeUtils.isValidTimezone(raw)) throw ApiError.badRequest('Invalid timezone identifier.');
    } else if (field.key === 'site.name') {
      if (raw.length < 2 || raw.length > 120) throw ApiError.badRequest('Site name must be 2–120 characters.');
    }
    updates.push({ key: field.key, value: raw });
  }

  for (const u of updates) {
    await settingsService.set(u.key, u.value, req.user.id);
  }
  await auditRepo.log({
    actorUserId: req.user.id,
    action: 'settings.update',
    entityType: 'system_settings',
    details: updates,
    ipAddress: req.ip,
  });
  res.redirect('/admin/settings?saved=1');
});

module.exports = { settingsPage, updateSettings, EDITABLE };
