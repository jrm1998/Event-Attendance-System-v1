'use strict';

const { body } = require('express-validator');

const login = [
  body('username')
    .trim()
    .toLowerCase()
    .isLength({ min: 3, max: 50 })
    .withMessage('Please enter your username.'),
  body('password').isLength({ min: 1, max: 200 }).withMessage('Please enter your password.'),
];

const changePassword = [
  body('currentPassword').isLength({ min: 1 }).withMessage('Current password is required.'),
  body('newPassword')
    .isLength({ min: 10, max: 128 })
    .withMessage('New password must be at least 10 characters.')
    .matches(/[a-z]/)
    .withMessage('New password must contain a lowercase letter.')
    .matches(/[A-Z]/)
    .withMessage('New password must contain an uppercase letter.')
    .matches(/[0-9]/)
    .withMessage('New password must contain a digit.'),
  body('confirmPassword').custom((value, { req }) => {
    if (value !== req.body.newPassword) {
      throw new Error('Password confirmation does not match.');
    }
    return true;
  }),
];

module.exports = { login, changePassword };
