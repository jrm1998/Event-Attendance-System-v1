'use strict';

const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const attendanceRepo = require('../repositories/attendanceRepo');
const eventRepo = require('../repositories/eventRepo');
const timeUtils = require('../utils/time');
const { toCsv } = require('../utils/csv');
const config = require('../config/environment');
const settingsService = require('./settingsService');

const REPORT_ROW_LIMIT = 5000;

const VERIFICATION_LABELS = {
  qr_gps: 'QR + GPS',
  manual: 'Manual',
  flagged: 'Flagged',
  auto: 'Auto',
};

function safeFilename(title) {
  return String(title).replace(/[^a-z0-9-_ ]/gi, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'event';
}

async function loadReport(eventId) {
  const event = await eventRepo.findById(eventId);
  if (!event) return null;
  const rows = await attendanceRepo.listForEvent(eventId, { limit: REPORT_ROW_LIMIT, offset: 0 });
  const stats = await attendanceRepo.countByStatusForEvent(eventId);
  return { event, rows, stats };
}

function reportRow(r, tz) {
  return {
    studentNumber: r.student_number,
    name: `${r.first_name} ${r.last_name}`,
    grade: r.grade_level_name || '',
    section: r.section_name || '',
    status: r.status,
    checkinAt: r.checkin_at ? timeUtils.formatDateTime(r.checkin_at, tz) : '',
    checkoutAt: r.checkout_at ? timeUtils.formatDateTime(r.checkout_at, tz) : '',
    distance: r.checkin_distance_meters != null ? Number(r.checkin_distance_meters) : '',
    accuracy: r.checkin_accuracy_meters != null ? Number(r.checkin_accuracy_meters) : '',
    verification: VERIFICATION_LABELS[r.verification_status] || r.verification_status,
    reason: r.verification_reason || '',
  };
}

const HEADERS = [
  'Student Number', 'Name', 'Grade', 'Section', 'Status',
  'Checked in', 'Checked out', 'Distance (m)', 'Accuracy (m)', 'Verification', 'Notes',
];

function toRowArray(v) {
  return [
    v.studentNumber, v.name, v.grade, v.section, v.status,
    v.checkinAt, v.checkoutAt, v.distance, v.accuracy, v.verification, v.reason,
  ];
}

function csvFilename(event) {
  return `attendance-${safeFilename(event.title)}-${event.id}.csv`;
}

async function attendanceCsv(eventId) {
  const report = await loadReport(eventId);
  if (!report) return null;
  const tz = config.school.timezone;
  const lines = [
    [`Attendance report: ${report.event.title}`],
    [`Venue: ${report.event.venue_name}`, `Radius: ${report.event.radius_meters} m`],
    [`Start: ${timeUtils.formatDateTime(report.event.start_at, tz)}`, `End: ${timeUtils.formatDateTime(report.event.end_at, tz)}`],
    [],
  ];
  const body = toCsv(
    HEADERS,
    report.rows.map((r) => toRowArray(reportRow(r, tz)))
  );
  return { filename: csvFilename(report.event), content: lines.map((l) => l.join(',')).join('\r\n') + '\r\n' + body };
}

async function attendanceXlsx(eventId) {
  const report = await loadReport(eventId);
  if (!report) return null;
  const tz = config.school.timezone;
  const wb = new ExcelJS.Workbook();
  wb.creator = await settingsService.getSchoolName();
  const ws = wb.addWorksheet('Attendance', { views: [{ state: 'frozen', ySplit: 1 }] });

  ws.addRow(HEADERS);
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } };
  for (const r of report.rows) {
    // Same formula-injection guard as CSV: neutralize leading formula characters.
    ws.addRow(
      toRowArray(reportRow(r, tz)).map((cell) => {
        const s = cell === null || cell === undefined ? '' : String(cell);
        return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
      })
    );
  }
  ws.columns.forEach((col) => {
    let max = 10;
    col.eachCell({ includeEmpty: false }, (cell) => {
      max = Math.max(max, String(cell.value || '').length + 2);
    });
    col.width = Math.min(max, 42);
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: HEADERS.length } };

  const buffer = await wb.xlsx.writeBuffer();
  return {
    filename: `attendance-${safeFilename(report.event.title)}-${report.event.id}.xlsx`,
    buffer,
  };
}

function pdfToBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

function pdfHeader(doc, title, subtitle, schoolName) {
  doc.font('Helvetica-Bold').fontSize(14).text(schoolName, { align: 'center' });
  doc.font('Helvetica-Bold').fontSize(11).text(title, { align: 'center' });
  if (subtitle) {
    doc.font('Helvetica').fontSize(8).fillColor('#444444').text(subtitle, { align: 'center' });
  }
  doc.fillColor('#000000').moveDown(0.6);
}

/**
 * Renders a simple paginated table. `columns` is [{label, width, key}];
 * rows are objects. Font must already be Helvetica 8.
 */
function pdfTable(doc, columns, rows) {
  const rowHeight = 14;
  const left = doc.page.margins.left;
  let y = doc.y;

  function drawHeader() {
    const x = left;
    doc.font('Helvetica-Bold').fontSize(8);
    let cx = x;
    columns.forEach((c) => {
      doc.text(c.label, cx + 2, y + 3, { width: c.width - 4, ellipsis: true, lineBreak: false });
      cx += c.width;
    });
    y += rowHeight;
    doc.moveTo(left, y).lineTo(left + columns.reduce((s, c) => s + c.width, 0), y).strokeColor('#999999').lineWidth(0.5).stroke();
    doc.font('Helvetica').fontSize(8);
    y += 2;
  }

  drawHeader();
  for (const row of rows) {
    if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      y = doc.page.margins.top;
      drawHeader();
    }
    let cx = left;
    columns.forEach((c) => {
      const value = row[c.key] === null || row[c.key] === undefined ? '' : String(row[c.key]);
      doc.text(value, cx + 2, y + 3, { width: c.width - 4, ellipsis: true, lineBreak: false });
      cx += c.width;
    });
    y += rowHeight;
  }
  doc.x = left;
  doc.y = y;
}

async function attendancePdf(eventId) {
  const report = await loadReport(eventId);
  if (!report) return null;
  const tz = config.school.timezone;
  const schoolName = await settingsService.getSchoolName();
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, bufferPages: true });
  pdfHeader(
    doc,
    `Attendance Report — ${report.event.title}`,
    `${report.event.venue_name} · ${timeUtils.formatDateTime(report.event.start_at, tz)} – ` +
      `${timeUtils.formatTime(report.event.end_at, tz)} · radius ${report.event.radius_meters} m · ` +
      `present ${report.stats.present || 0}, late ${report.stats.late || 0}, checked out ${report.stats.checked_out || 0}, ` +
      `absent ${report.stats.absent || 0}, pending ${report.stats.pending_review || 0}, rejected ${report.stats.rejected || 0}`,
    schoolName
  );

  const columns = [
    { label: 'Student No.', width: 70, key: 'studentNumber' },
    { label: 'Name', width: 150, key: 'name' },
    { label: 'Grade', width: 55, key: 'grade' },
    { label: 'Section', width: 80, key: 'section' },
    { label: 'Status', width: 65, key: 'status' },
    { label: 'Checked in', width: 100, key: 'checkinAt' },
    { label: 'Checked out', width: 100, key: 'checkoutAt' },
    { label: 'Dist (m)', width: 45, key: 'distance' },
    { label: 'Acc (m)', width: 45, key: 'accuracy' },
    { label: 'Verification', width: 60, key: 'verification' },
  ];
  pdfTable(doc, columns, report.rows.map((r) => reportRow(r, tz)));

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.font('Helvetica').fontSize(7).fillColor('#666666')
      .text(`Page ${i + 1} of ${range.count} · generated ${timeUtils.formatDateTime(new Date(), tz)} · times in ${tz}`,
        36, doc.page.height - 30, { width: doc.page.width - 72, align: 'center', lineBreak: false });
    doc.fillColor('#000000');
  }

  return {
    filename: `attendance-${safeFilename(report.event.title)}-${report.event.id}.pdf`,
    buffer: await pdfToBuffer(doc),
  };
}

/** Blank sign-in sheet with the eligible roster and empty signature columns. */
async function signinSheetPdf(eventId) {
  const event = await eventRepo.findById(eventId);
  if (!event) return null;
  const students = await eventRepo.listEligibleStudentRecords(eventId);
  const tz = config.school.timezone;
  const schoolName = await settingsService.getSchoolName();
  const doc = new PDFDocument({ size: 'A4', margin: 36, bufferPages: true });
  pdfHeader(
    doc,
    `Sign-in Sheet — ${event.title}`,
    `${event.venue_name} · ${timeUtils.formatDateTime(event.start_at, tz)} · ` +
      `${students.length} expected · present the QR code on screen to check in`,
    schoolName
  );

  const columns = [
    { label: '#', width: 24, key: 'idx' },
    { label: 'Student No.', width: 80, key: 'studentNumber' },
    { label: 'Name', width: 170, key: 'name' },
    { label: 'Section', width: 100, key: 'section' },
    { label: 'Signature (in)', width: 90, key: 'sigIn' },
    { label: 'Signature (out)', width: 90, key: 'sigOut' },
  ];
  pdfTable(
    doc,
    columns,
    students.map((s, i) => ({
      idx: i + 1,
      studentNumber: s.student_number,
      name: `${s.last_name}, ${s.first_name}`,
      section: s.section_name || '',
      sigIn: '',
      sigOut: '',
    }))
  );

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.font('Helvetica').fontSize(7).fillColor('#666666')
      .text(`Page ${i + 1} of ${range.count}`, 36, doc.page.height - 30, { width: doc.page.width - 72, align: 'center', lineBreak: false });
    doc.fillColor('#000000');
  }

  return {
    filename: `signin-sheet-${safeFilename(event.title)}-${event.id}.pdf`,
    buffer: await pdfToBuffer(doc),
  };
}

module.exports = { attendanceCsv, attendanceXlsx, attendancePdf, signinSheetPdf, safeFilename };
