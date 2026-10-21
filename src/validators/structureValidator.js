'use strict';

const { body, param } = require('express-validator');

// --- Structure ---

const schoolYear = [
  body('name').matches(/^\d{4}-\d{4}$/).withMessage('School year name must look like 2026-2027.'),
  body('startDate').isISO8601().withMessage('Start date is required.'),
  body('endDate').isISO8601().withMessage('End date is required.'),
  body('status').optional().isIn(['upcoming', 'active', 'closed']),
];

const gradeLevel = [
  body('name').trim().isLength({ min: 2, max: 50 }).withMessage('Grade level name is required.'),
  body('sortOrder').optional({ values: 'falsy' }).isInt({ min: 0, max: 255 }),
];

const section = [
  body('gradeLevelId').isInt({ min: 1 }).withMessage('Grade level is required.'),
  body('schoolYearId').isInt({ min: 1 }).withMessage('School year is required.'),
  body('name').trim().isLength({ min: 1, max: 50 }).withMessage('Section name is required.'),
  body('status').optional().isIn(['active', 'archived']),
];

// --- Users ---

const createUser = [
  body('role').isIn(['admin', 'teacher']).withMessage('Role must be admin or teacher.'),
  body('username')
    .trim()
    .toLowerCase()
    .matches(/^[a-zA-Z0-9._-]{3,50}$/)
    .withMessage('Username must be 3-50 characters (letters, digits, dot, underscore, hyphen).'),
  body('email').optional({ values: 'falsy' }).trim().isEmail(),
  body('password')
    .isLength({ min: 10, max: 128 })
    .withMessage('Password must be at least 10 characters.')
    .matches(/[a-z]/).matches(/[A-Z]/).matches(/[0-9]/)
    .withMessage('Password needs upper case, lower case, and a digit.'),
  body('firstName').if(body('role').equals('teacher')).trim().isLength({ min: 1, max: 80 }),
  body('lastName').if(body('role').equals('teacher')).trim().isLength({ min: 1, max: 80 }),
  body('employeeNumber')
    .if(body('role').equals('teacher'))
    .trim()
    .matches(/^[A-Za-z0-9-]{3,30}$/)
    .withMessage('Employee number is required for teachers.'),
];

const updateUserStatus = [
  param('id').isInt({ min: 1 }),
  body('status').isIn(['active', 'inactive', 'suspended']).withMessage('Invalid status.'),
];

const resetPassword = [
  param('id').isInt({ min: 1 }),
  body('newPassword')
    .optional({ values: 'falsy' })
    .isLength({ min: 10, max: 128 })
    .matches(/[a-z]/).matches(/[A-Z]/).matches(/[0-9]/)
    .withMessage('Password must be 10+ chars with upper, lower, and digit.'),
];

module.exports = { schoolYear, gradeLevel, section, createUser, updateUserStatus, resetPassword };
