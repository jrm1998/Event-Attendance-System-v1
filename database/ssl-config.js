'use strict';

const fs = require('fs');

/**
 * Builds mysql2 TLS options from environment variables (Aiven MySQL and any
 * other managed MySQL that requires TLS).
 *
 *   DB_SSL=true                       enable TLS (no custom CA: system trust store)
 *   DB_SSL_CA="<pem content>"         enable TLS, verify against this CA cert
 *   DB_SSL_CA_PATH=/path/to/ca.pem    enable TLS, verify against CA cert file
 *   DB_SSL_REJECT_UNAUTHORIZED=false  DANGEROUS: skip verification (local dev only)
 *
 * TLS is also enabled implicitly when DB_SSL_CA / DB_SSL_CA_PATH is set.
 * Verification defaults to ON and must never be disabled in production.
 */
function toBool(raw, fallback) {
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function buildSslOptions(env = process.env, { log } = {}) {
  const caContent = env.DB_SSL_CA || '';
  const caPath = env.DB_SSL_CA_PATH || '';
  const rejectUnauthorized = toBool(env.DB_SSL_REJECT_UNAUTHORIZED, true);
  const enabled =
    toBool(env.DB_SSL, false) || caContent !== '' || caPath !== '';

  if (!enabled) return undefined;

  const ssl = { rejectUnauthorized };
  if (caContent) {
    ssl.ca = caContent.replace(/\\n/g, '\n');
  } else if (caPath) {
    ssl.ca = fs.readFileSync(caPath, 'utf8');
  } else if (log && !rejectUnauthorized) {
    log('[db] WARNING: DB_SSL enabled without a CA certificate and with verification disabled — development only.');
  }
  return ssl;
}

module.exports = { buildSslOptions };
