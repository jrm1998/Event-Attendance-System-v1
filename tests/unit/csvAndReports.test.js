'use strict';

import { describe, it, expect } from 'vitest';
const { csvCell, toCsv } = require('../../src/utils/csv');
const reportService = require('../../src/services/reportService');

describe('csv formula-injection guard', () => {
  it('prefixes dangerous leading characters with a single quote', () => {
    for (const dangerous of ['=cmd|\' /C calc!A0', '+SUM(A1)', '-1+1', '@SUM(A1)', '\tTAB']) {
      expect(csvCell(dangerous).startsWith("'")).toBe(true);
    }
    // \r also triggers quoting, so the guard quote sits inside the quoted cell.
    expect(csvCell('\rCR')).toBe('"\'\rCR"');
  });

  it('leaves safe values untouched', () => {
    expect(csvCell('2026-0001')).toBe('2026-0001');
    expect(csvCell('Juan dela Cruz')).toBe('Juan dela Cruz');
    expect(csvCell('')).toBe('');
    expect(csvCell(null)).toBe('');
  });

  it('quotes values containing commas, quotes or newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('builds complete rows with CRLF line endings', () => {
    const csv = toCsv(['a', 'b'], [['1', '2'], ['3', '4']]);
    expect(csv).toBe('a,b\r\n1,2\r\n3,4\r\n');
  });

  it('neutralizes a student name crafted as a formula', () => {
    const csv = toCsv(['Name'], [['=HYPERLINK("http://evil","click")']]);
    expect(csv).toContain("'=HYPERLINK");
  });
});

describe('reportService helpers', () => {
  it('produces safe download filenames from event titles', () => {
    expect(reportService.safeFilename('Science Fair 2026')).toBe('Science-Fair-2026');
    expect(reportService.safeFilename('..\\..\\etc/passwd')).toBe('etcpasswd');
    expect(reportService.safeFilename('***')).toBe('event');
  });
});
