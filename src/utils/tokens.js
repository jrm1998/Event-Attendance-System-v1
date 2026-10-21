'use strict';

const crypto = require('crypto');

/** URL-safe opaque token (never stored in plaintext; only its hash is). */
function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Constant-time comparison of two hex digests of equal length. */
function safeHexEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

module.exports = { randomToken, sha256Hex, safeHexEqual };
