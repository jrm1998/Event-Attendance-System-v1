'use strict';

const { body, param } = require('express-validator');

const submission = [
  body('qr').isString().isLength({ min: 5, max: 500 }).withMessage('Scan a valid QR code first.'),
  body('latitude')
    .exists({ checkNull: true })
    .isFloat({ min: -90, max: 90 })
    .withMessage('A valid GPS latitude is required.'),
  body('longitude')
    .exists({ checkNull: true })
    .isFloat({ min: -180, max: 180 })
    .withMessage('A valid GPS longitude is required.'),
  body('accuracy')
    .exists({ checkNull: true })
    .isFloat({ min: 0, max: 10000 })
    .withMessage('A valid GPS accuracy value is required.'),
  body('timestamp').optional().isISO8601().withMessage('Invalid location timestamp.'),
];

const reason = body('reason')
  .isString()
  .trim()
  .isLength({ min: 5, max: 500 })
  .withMessage('A reason between 5 and 500 characters is required.');

const idParam = param('id').isInt({ min: 1 }).withMessage('Invalid attendance record id.');

const review = [idParam, body('decision').isIn(['approve', 'reject']).withMessage('Invalid decision.'), reason];

const manualEntry = [
  param('id').isInt({ min: 1 }).withMessage('Invalid event id.'),
  body('studentId').isInt({ min: 1 }).withMessage('A student must be selected.'),
  body('status').isIn(['present', 'late', 'absent']).withMessage('Status must be present, late or absent.'),
  reason,
];

const manualCheckout = [idParam, reason];

const correction = [
  idParam,
  body('status').isIn(['present', 'late', 'absent']).withMessage('Status must be present, late or absent.'),
  reason,
];

const auditQuery = [idParam];

module.exports = { submission, review, manualEntry, manualCheckout, correction, auditQuery, idParam };
