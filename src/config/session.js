'use strict';

const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const config = require('./environment');
const pool = require('./database');

function createSessionMiddleware() {
  // Pass the app's TLS-enabled pool to the store: express-mysql-session builds
  // its own pool from a small option whitelist that DROPS the ssl key, so
  // pointing it at Aiven by host/port alone would connect without TLS and fail.
  const store = new MySQLStore(
    {
      createDatabaseTable: true,
      clearExpired: true,
      checkExpirationInterval: 15 * 60 * 1000,
    },
    pool
  );

  return session({
    name: 'att.sid',
    secret: config.session.secret,
    store,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    proxy: !!config.trustProxy,
    cookie: {
      httpOnly: true,
      secure: config.session.cookieSecure,
      sameSite: config.session.cookieSameSite,
      maxAge: config.session.ttlMinutes * 60 * 1000,
    },
  });
}

module.exports = createSessionMiddleware;
