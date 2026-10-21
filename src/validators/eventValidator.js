'use strict';

const { body, query, param } = require('express-validator');

const createOrUpdate = [
  body('title').trim().isLength({ min: 3, max: 200 }).withMessage('Title must be 3-200 characters.'),
  body('description').optional({ values: 'falsy' }).trim().isLength({ max: 5000 }),
  body('category').optional({ values: 'falsy' }).trim().isLength({ max: 50 }),
  body('venueName').trim().isLength({ min: 3, max: 200 }).withMessage('Venue name is required.'),
  body('latitude')
    .isFloat({ min: -90, max: 90 })
    .withMessage('Latitude must be between -90 and 90.'),
  body('longitude')
    .isFloat({ min: -180, max: 180 })
    .withMessage('Longitude must be between -180 and 180.'),
  body('radiusMeters').isInt({ min: 10, max: 10000 }).withMessage('Radius must be 10-10000 m.'),
  body('maxGpsAccuracyMeters')
    .isInt({ min: 5, max: 1000 })
    .withMessage('Max GPS accuracy must be 5-1000 m.'),
  body('startAt').isISO8601().withMessage('Event start date/time is required.'),
  body('endAt').isISO8601().withMessage('Event end date/time is required.'),
  body('checkinOpensAt').isISO8601().withMessage('Check-in opening time is required.'),
  body('checkinClosesAt').isISO8601().withMessage('Check-in closing time is required.'),
  body('lateAfter').optional({ values: 'falsy' }).isISO8601(),
  // HTML checkboxes submit "on"; API clients may send true/false or "true"/"false".
  body('checkoutRequired')
    .optional()
    .custom((v) => v === true || v === false || ['on', 'true', 'false', '1', '0'].includes(String(v)))
    .withMessage('Invalid value for checkoutRequired.'),
  body('maxAttendance').optional({ values: 'falsy' }).isInt({ min: 1 }),
  body('eligibleGradeIds').optional().isArray({ max: 100 }),
  body('eligibleSectionIds').optional().isArray({ max: 200 }),
  body('eligibleStudentIds').optional().isArray({ max: 5000 }),
  body('teacherIds').optional().isArray({ max: 50 }),
];

const listQuery = [
  query('status').optional({ values: 'falsy' }).isIn(['draft', 'published', 'completed', 'cancelled', 'archived']),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
];

const idParam = param('id').isInt({ min: 1 }).withMessage('Invalid event id.');

const action = [idParam];

module.exports = { createOrUpdate, listQuery, idParam, action };
