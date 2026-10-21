'use strict';

/**
 * CSV cell serialization with spreadsheet formula-injection protection.
 * Values beginning with = + - @ TAB or CR are prefixed with a single quote
 * so spreadsheet applications do not evaluate them.
 */
function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }
  if (/[",\r\n]/.test(s)) {
    s = `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsv(headers, rows) {
  const lines = [headers.map((h) => csvCell(h)).join(',')];
  for (const row of rows) {
    lines.push(row.map((c) => csvCell(c)).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

module.exports = { csvCell, toCsv };
