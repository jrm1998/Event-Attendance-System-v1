'use strict';

const crypto = require('crypto');

/**
 * Synchronizer-token CSRF protection (csurf is deprecated/unmaintained).
 * A per-session random token is embedded in forms (_csrf) and sent by
 * fetch helpers via the X-CSRF-Token header. All state-changing requests
 * must present the token. Session cookies additionally use SameSite=Lax.
 */
function csrfMiddleware(req, res, next) {
  if (!req.session) return next();
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  const token = req.session.csrfToken;
  res.locals.csrfToken = token;

  const method = req.method.toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return next();

  const provided = req.get('x-csrf-token') || req.body?._csrf || '';
  if (typeof provided !== 'string' || provided.length !== token.length) {
    return reject(req, res);
  }
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(token, 'utf8');
  if (!crypto.timingSafeEqual(a, b)) {
    return reject(req, res);
  }
  next();
}

function reject(req, res) {
  res.status(403).json({
    error: 'Security token invalid or missing. Reload the page and try again.',
    code: 'csrf_failure',
  });
}

module.exports = csrfMiddleware;
