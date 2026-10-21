'use strict';

const qrService = require('../services/qrService');
const eventRepo = require('../repositories/eventRepo');
const settingsService = require('../services/settingsService');
const auditService = require('../services/auditService');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/errors');

const issueApi = asyncHandler(async (req, res) => {
  const eventId = Number.parseInt(req.params.id, 10);
  const event = await eventRepo.findById(eventId);
  if (!event) throw ApiError.notFound('Event not found.');
  if (['completed', 'cancelled', 'archived'].includes(event.status)) {
    throw ApiError.badRequest(`QR codes cannot be issued for a ${event.status} event.`);
  }
  const issued = await qrService.issueToken(event, req.user);
  res.json({
    ok: true,
    dataUrl: issued.dataUrl,
    expiresAt: issued.expiresAt,
    rotationSeconds: issued.rotationSeconds,
    ttlSeconds: issued.ttlSeconds,
  });
});

const revokeApi = asyncHandler(async (req, res) => {
  const eventId = Number.parseInt(req.params.id, 10);
  const count = await qrService.revokeEventTokens(eventId);
  await auditService.logAdminAction(req, 'qr.revoke', 'event', eventId, { revoked: count });
  res.json({ ok: true, revoked: count });
});

const displayPage = asyncHandler(async (req, res) => {
  const eventId = Number.parseInt(req.params.id, 10);
  const event = await eventRepo.findById(eventId);
  if (!event) throw ApiError.notFound('Event not found.');
  const [eligibleCount, settings] = await Promise.all([
    eventRepo.countEligibleStudents(eventId),
    settingsService.getPublicConfig(),
  ]);
  res.render('events/qr_display', {
    title: `QR Screen · ${event.title}`,
    event,
    eligibleCount,
    settings,
  });
});

module.exports = { issueApi, revokeApi, displayPage };
