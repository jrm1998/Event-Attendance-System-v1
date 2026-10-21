'use strict';

const rateLimit = require('express-rate-limit');
const config = require('../config/environment');

function makeLimiter({ windowMinutes, max, message, skipSuccessfulRequests = false }) {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests,
    message: { error: message, code: 'rate_limited' },
  });
}

const apiLimiter = makeLimiter({
  windowMinutes: config.rateLimits.api.windowMinutes,
  max: config.rateLimits.api.max,
  message: 'Too many requests. Slow down and try again shortly.',
});

const loginLimiter = makeLimiter({
  windowMinutes: config.rateLimits.login.windowMinutes,
  max: config.rateLimits.login.max,
  message: 'Too many login attempts. Please wait before trying again.',
  skipSuccessfulRequests: true,
});

const attendanceLimiter = makeLimiter({
  windowMinutes: config.rateLimits.attendance.windowMinutes,
  max: config.rateLimits.attendance.max,
  message: 'Too many attendance attempts. Please wait a moment and try again.',
});

const qrLimiter = makeLimiter({
  windowMinutes: 1,
  max: 60,
  message: 'QR endpoint rate limit exceeded.',
});

module.exports = { apiLimiter, loginLimiter, attendanceLimiter, qrLimiter };
