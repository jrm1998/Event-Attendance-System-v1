'use strict';

const bcrypt = require('bcryptjs');
const userRepo = require('../repositories/userRepo');
const loginSecurityRepo = require('../repositories/loginSecurityRepo');
const notificationRepo = require('../repositories/notificationRepo');
const settingsService = require('./settingsService');
const sockets = require('../sockets');
const { ApiError } = require('../utils/errors');
const logger = require('../utils/logger');

function nowUtcDate() {
  return new Date();
}

function promisifyRegenerate(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

/**
 * Authenticates a user. Throws ApiError(401) with a GENERIC message on any
 * credential failure to prevent account enumeration; ApiError(429) when
 * temporarily locked out. On success the session is regenerated and the
 * user id stored.
 */
async function login(req, rawUsername, password) {
  const username = String(rawUsername || '').trim().toLowerCase();
  const { maxFailedAttempts, lockoutMinutes } = require('../config/environment').loginSecurity;

  const [usernameFailures, ipFailures] = await Promise.all([
    loginSecurityRepo.countUsernameFailures(username, lockoutMinutes),
    loginSecurityRepo.countIpFailures(req.ip, lockoutMinutes),
  ]);

  if (usernameFailures >= maxFailedAttempts || ipFailures >= maxFailedAttempts * 4) {
    await loginSecurityRepo.logAttempt({
      username,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      outcome: 'locked',
    });
    logger.warn(`Login locked for username=${username} ip=${req.ip}`);
    throw ApiError.tooMany(
      `Too many failed attempts. This account is temporarily locked for ${lockoutMinutes} minutes.`
    );
  }

  const credentials = await userRepo.findCredentialsByUsername(username);
  const passwordOk =
    credentials && (await bcrypt.compare(String(password || ''), credentials.password_hash));

  if (!passwordOk) {
    await loginSecurityRepo.logAttempt({
      userId: credentials ? credentials.id : null,
      username,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      outcome: 'failed',
    });
    throw ApiError.unauthorized('Invalid username or password.');
  }

  if (credentials.status !== 'active') {
    await loginSecurityRepo.logAttempt({
      userId: credentials.id,
      username,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      outcome: 'failed',
    });
    throw ApiError.forbidden('This account is not active. Please contact the school administrator.');
  }

  // Session fixation defense: new session id after authentication.
  await promisifyRegenerate(req);
  req.session.userId = credentials.id;

  await userRepo.updateLastLogin(credentials.id, nowUtcDate());
  await loginSecurityRepo.logAttempt({
    userId: credentials.id,
    username,
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
    outcome: 'success',
  });

  return { id: credentials.id, role: credentials.role, username: credentials.username };
}

async function logout(req) {
  const userId = req.session.userId;
  if (userId) {
    await loginSecurityRepo
      .logAttempt({
        userId,
        username: req.user ? req.user.username : 'unknown',
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        outcome: 'logout',
      })
      .catch(() => {});
    // A destroyed session must not leave live event feeds or web-push
    // previews reachable on a shared device.
    sockets.disconnectUser(userId);
    await notificationRepo.revokeAllSubscriptions(userId).catch(() => {});
  }
  await new Promise((resolve) => {
    req.session.destroy(() => resolve());
  });
  return { userId };
}

async function changePassword(req, currentPassword, newPassword) {
  const credentials = await userRepo.findCredentialsByUsername(req.user.username);
  if (!credentials || !(await bcrypt.compare(String(currentPassword || ''), credentials.password_hash))) {
    throw ApiError.badRequest('Current password is incorrect.');
  }
  validatePasswordStrength(newPassword);
  const hash = await bcrypt.hash(newPassword, 12);
  await userRepo.updatePassword(req.user.id, hash);
}

function validatePasswordStrength(password) {
  const errors = [];
  if (typeof password !== 'string' || password.length < 10) errors.push('at least 10 characters');
  if (!/[a-z]/.test(password || '')) errors.push('a lowercase letter');
  if (!/[A-Z]/.test(password || '')) errors.push('an uppercase letter');
  if (!/[0-9]/.test(password || '')) errors.push('a digit');
  if (errors.length) {
    throw ApiError.badRequest(`Password must contain ${errors.join(', ')}.`);
  }
}

async function getSchoolSettings() {
  return settingsService.getPublicConfig();
}

module.exports = { login, logout, changePassword, validatePasswordStrength, getSchoolSettings };
