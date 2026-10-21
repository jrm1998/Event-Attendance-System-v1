'use strict';

const db = require('../config/database');
const config = require('../config/environment');

const CACHE_TTL_MS = 30 * 1000;
let cache = { data: null, loadedAt: 0 };

async function getAll(force = false) {
  if (!force && cache.data && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
    return cache.data;
  }
  const [rows] = await db.query('SELECT setting_key, setting_value FROM system_settings');
  const data = {};
  for (const row of rows) data[row.setting_key] = row.setting_value;
  cache = { data, loadedAt: Date.now() };
  return data;
}

async function get(key, fallback = null) {
  const all = await getAll();
  return all[key] !== undefined && all[key] !== null ? all[key] : fallback;
}

async function getNumber(key, fallback) {
  const raw = await get(key);
  if (raw === null || raw === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

/** Editable school name; falls back to SCHOOL_NAME from the environment. */
async function getSchoolName() {
  const all = await getAll();
  return all['site.name'] || config.school.name;
}

async function set(key, value, updatedBy) {
  await db.query(
    `INSERT INTO system_settings (setting_key, setting_value, updated_by) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
    [key, String(value), updatedBy]
  );
  cache = { data: null, loadedAt: 0 };
}

/** Effective GPS/QR limits: system settings override .env defaults. */
async function getGpsConfig() {
  const all = await getAll();
  const num = (key, fallback) => {
    const value = Number(all[key]);
    return Number.isFinite(value) ? value : fallback;
  };
  return {
    defaultRadiusMeters: num('gps.default_radius_meters', config.gps.defaultRadiusMeters),
    maxAccuracyMeters: num('gps.max_accuracy_meters', config.gps.maxAccuracyMeters),
    freshnessSeconds: num('gps.freshness_seconds', config.gps.freshnessSeconds),
    flagDistanceMultiplier: num('gps.flag_distance_multiplier', config.gps.flagDistanceMultiplier),
  };
}

async function getQrConfig() {
  const all = await getAll();
  const num = (key, fallback) => {
    const value = Number(all[key]);
    return Number.isFinite(value) ? value : fallback;
  };
  const rotation = num('qr.rotation_seconds', config.qr.rotationSeconds);
  return {
    rotationSeconds: rotation,
    tokenTtlSeconds: num('qr.token_ttl_seconds', rotation + 5),
  };
}

async function getPublicConfig() {
  const all = await getAll();
  return {
    siteName: all['site.name'] || config.school.name,
    timezone: all['site.timezone'] || config.school.timezone,
    qrRotationSeconds: await getNumber('qr.rotation_seconds', config.qr.rotationSeconds),
    gps: await getGpsConfig(),
  };
}

function invalidate() {
  cache = { data: null, loadedAt: 0 };
}

module.exports = { getAll, get, getNumber, getSchoolName, set, getGpsConfig, getQrConfig, getPublicConfig, invalidate };
