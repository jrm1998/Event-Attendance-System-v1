'use strict';

const express = require('express');
const reportService = require('../services/reportService');
const { requireAuth } = require('../middleware/authenticate');
const { requireEventAccess } = require('../middleware/authorize');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/errors');

const router = express.Router();

function sendCsv(res, report) {
  if (!report) throw ApiError.notFound('Event not found.');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${report.filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(report.content);
}

function sendBinary(res, report, contentType) {
  if (!report) throw ApiError.notFound('Event not found.');
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${report.filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(report.buffer);
}

router.get(
  '/:id(\\d+)/reports/attendance.csv',
  requireAuth,
  requireEventAccess('id'),
  asyncHandler(async (req, res) => {
    sendCsv(res, await reportService.attendanceCsv(req.eventAccess.eventId));
  })
);

router.get(
  '/:id(\\d+)/reports/attendance.xlsx',
  requireAuth,
  requireEventAccess('id'),
  asyncHandler(async (req, res) => {
    sendBinary(res, await reportService.attendanceXlsx(req.eventAccess.eventId),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  })
);

router.get(
  '/:id(\\d+)/reports/attendance.pdf',
  requireAuth,
  requireEventAccess('id'),
  asyncHandler(async (req, res) => {
    sendBinary(res, await reportService.attendancePdf(req.eventAccess.eventId), 'application/pdf');
  })
);

router.get(
  '/:id(\\d+)/reports/signin-sheet.pdf',
  requireAuth,
  requireEventAccess('id'),
  asyncHandler(async (req, res) => {
    sendBinary(res, await reportService.signinSheetPdf(req.eventAccess.eventId), 'application/pdf');
  })
);

module.exports = router;
