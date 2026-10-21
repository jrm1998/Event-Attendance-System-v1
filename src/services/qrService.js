'use strict';

const QRCode = require('qrcode');
const db = require('../config/database');
const qrRepo = require('../repositories/qrRepo');
const settingsService = require('./settingsService');
const { randomToken, sha256Hex } = require('../utils/tokens');
const { ApiError } = require('../utils/errors');

const QR_PREFIX = 'ATT';

/**
 * Issues a fresh QR token for an event. Only the SHA-256 hash is stored;
 * the raw token exists solely inside the displayed QR payload and the
 * HTTP response to the authorized display screen.
 *
 * Payload format: ATT:<eventId>:<rawToken>
 */
async function issueToken(event, actor) {
  const qrConfig = await settingsService.getQrConfig();
  const rawToken = randomToken(32);
  const tokenHash = sha256Hex(rawToken);
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + qrConfig.tokenTtlSeconds * 1000);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await qrRepo.insert(conn, {
      eventId: event.id,
      tokenHash,
      issuedAt,
      expiresAt,
      createdBy: actor.id,
    });
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  const payload = `${QR_PREFIX}:${event.id}:${rawToken}`;
  const dataUrl = await QRCode.toDataURL(payload, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 460,
    color: { dark: '#1a3a5c', light: '#ffffff' },
  });

  return {
    payload,
    dataUrl,
    issuedAt,
    expiresAt,
    rotationSeconds: qrConfig.rotationSeconds,
    ttlSeconds: qrConfig.tokenTtlSeconds,
  };
}

/**
 * Structural parse only — extracts the event id without validating the token
 * against the database. Lets the attendance pipeline run its idempotency check
 * (already checked in?) before rejecting on an expired/rotated code.
 */
function parsePayload(rawPayload) {
  const parts = String(rawPayload || '').split(':');
  if (parts.length !== 3 || parts[0] !== QR_PREFIX) {
    throw ApiError.badRequest('That is not a valid attendance QR code.');
  }
  const eventId = Number.parseInt(parts[1], 10);
  if (!Number.isInteger(eventId) || eventId <= 0) {
    throw ApiError.badRequest('That QR code is malformed.');
  }
  return { eventId, tokenHash: sha256Hex(parts[2]) };
}

/** Validates a scanned payload against event + token state. */
async function validateScannedPayload(rawPayload) {
  const { eventId, tokenHash } = parsePayload(rawPayload);
  const record = await qrRepo.findByHash(tokenHash);
  if (!record || record.event_id !== eventId) {
    throw ApiError.badRequest('This QR code is not valid for this event.');
  }
  const now = new Date();
  if (record.revoked_at) {
    throw ApiError.badRequest('This QR code has been revoked. Ask the coordinator for the current code.');
  }
  if (new Date(record.expires_at) <= now) {
    throw ApiError.badRequest('This QR code has expired. Scan the code currently shown on the event screen.');
  }
  return { eventId, token: record };
}

async function revokeEventTokens(eventId) {
  return qrRepo.revokeForEvent(eventId);
}

module.exports = { issueToken, parsePayload, validateScannedPayload, revokeEventTokens, QR_PREFIX };
