'use strict';

const config = require('../config/environment');

function isValidTimezone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function nowUtc() {
  return new Date();
}

function toMysqlDatetime(date) {
  return date instanceof Date ? date : new Date(date);
}

/** Format a UTC Date in the school timezone: "MMM D, YYYY h:mm A" */
function formatDateTime(date, tz = config.school.timezone) {
  if (!date) return '—';
  const d = date instanceof Date ? date : new Date(date);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d);
}

/** Short time-only format in the school timezone: "h:mm A" */
function formatTime(date, tz = config.school.timezone) {
  if (!date) return '—';
  const d = date instanceof Date ? date : new Date(date);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d);
}

/**
 * Converts a wall-clock time in `tz` to the corresponding UTC instant.
 * Iterates because the timezone offset itself depends on the instant (DST).
 */
function zonedWallTimeToUtc(year, month, day, hour, minute, tz) {
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  let ts = wallAsUtc;
  for (let i = 0; i < 3; i += 1) {
    const parts = {};
    for (const p of formatter.formatToParts(new Date(ts))) {
      if (p.type !== 'literal') parts[p.type] = p.value;
    }
    const rendered = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second)
    );
    const diff = wallAsUtc - rendered;
    if (diff === 0) break;
    ts += diff;
  }
  return new Date(ts);
}

/**
 * Parses what a <input type="datetime-local"> submits ("YYYY-MM-DDTHH:mm") as
 * school-local wall time and returns a UTC Date. ISO strings with an explicit
 * offset/Z are parsed by Date directly.
 */
function parseSchoolLocal(value, tz = config.school.timezone) {
  if (value instanceof Date) return value;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return new Date(value);
  return zonedWallTimeToUtc(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    tz
  );
}

/** Formats a UTC date as a school-local "YYYY-MM-DDTHH:mm" for datetime-local inputs. */
function formatDatetimeLocal(date, tz = config.school.timezone) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const parts = {};
  new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .formatToParts(d)
    .forEach((p) => {
      if (p.type !== 'literal') parts[p.type] = p.value;
    });
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** ISO date (YYYY-MM-DD) in the school timezone, for grouping by day. */
function dateKeyInTz(date, tz = config.school.timezone) {
  const d = date instanceof Date ? date : new Date(date);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  return parts;
}

module.exports = {
  isValidTimezone,
  nowUtc,
  toMysqlDatetime,
  formatDateTime,
  formatTime,
  dateKeyInTz,
  parseSchoolLocal,
  formatDatetimeLocal,
};
