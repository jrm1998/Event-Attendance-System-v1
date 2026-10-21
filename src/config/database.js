'use strict';

const mysql = require('mysql2/promise');
const config = require('./environment');
const { buildSslOptions } = require('../../database/ssl-config');
const logger = require('../utils/logger');

const ssl = buildSslOptions(process.env, { log: (msg) => logger.info(msg) });

// timezone: 'Z' serializes JS Dates as UTC strings so every DATETIME in the
// database is consistently stored in UTC.
const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: config.db.connectionLimit,
  queueLimit: 0,
  connectTimeout: 15000,
  timezone: 'Z',
  charset: 'utf8mb4',
  namedPlaceholders: true,
  decimalNumbers: false,
  dateStrings: false,
  ...(ssl ? { ssl } : {}),
});

// Keep the MySQL session timezone in UTC too: the `timezone: 'Z'` option only
// affects client-side serialization, while NOW()/TIMESTAMP defaults follow the
// server session. Numeric offsets work without the server's tz tables.
pool.on('connection', (connection) => {
  connection.query("SET time_zone = '+00:00'", (err) => {
    if (err) logger.warn(`[db] could not set session time_zone: ${err.message}`);
  });
});

module.exports = pool;
