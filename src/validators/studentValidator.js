'use strict';

const { body, param, query } = require('express-validator');

const STUDENT_STATUSES = ['active', 'inactive', 'archived'];

const idParam = param('id').isInt({ min: 1 }).withMessage('Invalid id.');

const listQuery = [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 200 }),
  query('gradeLevelId').optional({ values: 'falsy' }).isInt({ min: 1 }),
  query('sectionId').optional({ values: 'falsy' }).isInt({ min: 1 }),
  query('status').optional({ values: 'falsy' }).isIn(STUDENT_STATUSES),
];

const create = [
  body('studentNumber')
    .trim()
    .matches(/^[A-Za-z0-9-]{3,30}$/)
    .withMessage('Student number must be 3-30 characters (letters, digits, hyphen).'),
  body('firstName').trim().isLength({ min: 1, max: 80 }).withMessage('First name is required.'),
  body('middleName').optional({ values: 'falsy' }).trim().isLength({ max: 80 }),
  body('lastName').trim().isLength({ min: 1, max: 80 }).withMessage('Last name is required.'),
  body('email').optional({ values: 'falsy' }).trim().isEmail().withMessage('Email is not valid.'),
  body('gradeLevelId').optional({ values: 'falsy' }).isInt({ min: 1 }),
  body('sectionId').optional({ values: 'falsy' }).isInt({ min: 1 }),
  body('schoolYearId').optional({ values: 'falsy' }).isInt({ min: 1 }),
  body('username')
    .optional({ values: 'falsy' })
    .trim()
    .matches(/^[a-zA-Z0-9._-]{3,50}$/)
    .withMessage('Username must be 3-50 characters (letters, digits, dot, underscore, hyphen).'),
  body('password')
    .optional({ values: 'falsy' })
    .isLength({ min: 10, max: 128 })
    .withMessage('Password must be at least 10 characters.')
    .matches(/[a-z]/).matches(/[A-Z]/).matches(/[0-9]/)
    .withMessage('Password needs upper case, lower case, and a digit.'),
];

const update = [idParam, ...create.map((chain) => chain.optional({ values: undefined }))];

const bulk = [
  body('action').isIn(['activate', 'deactivate', 'archive']).withMessage('Unknown bulk action.'),
  body('ids').isArray({ min: 1, max: 500 }).withMessage('Select at least one student.'),
  body('ids.*').isInt({ min: 1 }),
];

const importCommit = body('confirm').optional().isBoolean();

module.exports = { idParam, listQuery, create, update, bulk, importCommit, STUDENT_STATUSES };
