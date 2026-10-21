'use strict';

const { validationResult } = require('express-validator');
const authService = require('../services/authService');
const userRepo = require('../repositories/userRepo');
const authValidator = require('../validators/authValidator');
const flash = require('../utils/flash');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/errors');
const { isApi } = require('../middleware/authorize');

function homePathFor(user) {
  if (!user) return '/login';
  if (user.role === 'admin') return '/admin';
  if (user.role === 'teacher') return '/teacher';
  return '/student';
}

async function getLogin(req, res) {
  if (req.user) return res.redirect(homePathFor(req.user));
  res.render('auth/login', { title: 'Sign in' });
}

const postLogin = [
  ...authValidator.login,
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const message = errors.array({ onlyFirstError: true })[0].msg;
      if (isApi(req)) return res.status(400).json({ error: message, code: 'validation' });
      flash.set(req, 'danger', message);
      return res.redirect('/login');
    }
    try {
      const user = await authService.login(req, req.body.username, req.body.password);
      if (isApi(req)) return res.json({ ok: true, redirect: homePathFor(user), role: user.role });
      return res.redirect(homePathFor(user));
    } catch (err) {
      if (err instanceof ApiError && err.status < 500) {
        if (isApi(req)) return res.status(err.status).json({ error: err.message, code: err.code });
        flash.set(req, 'danger', err.message);
        return res.redirect('/login');
      }
      throw err;
    }
  }),
];

const postLogout = [
  requireAuthSessionOnly,
  asyncHandler(async (req, res) => {
    await authService.logout(req);
    res.clearCookie('att.sid');
    if (isApi(req)) return res.json({ ok: true });
    return res.redirect('/login');
  }),
];

async function requireAuthSessionOnly(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

async function getSession(req, res) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in.' });
  res.json({
    user: {
      id: req.user.id,
      username: req.user.username,
      role: req.user.role,
      fullName: req.user.fullName,
      studentNumber: req.user.studentNumber,
    },
  });
}

async function getCsrf(req, res) {
  res.json({ csrfToken: res.locals.csrfToken });
}

async function getProfile(req, res) {
  const details = await userRepo.getDetailsById(req.user.id);
  res.render('profile', { title: 'My Account', details });
}

const postChangePassword = [
  ...authValidator.changePassword,
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const message = errors.array({ onlyFirstError: true })[0].msg;
      if (isApi(req)) return res.status(400).json({ error: message, code: 'validation' });
      flash.set(req, 'danger', message);
      return res.redirect('/profile');
    }
    try {
      await authService.changePassword(req, req.body.currentPassword, req.body.newPassword);
    } catch (err) {
      if (err instanceof ApiError && err.status < 500) {
        if (isApi(req)) return res.status(err.status).json({ error: err.message, code: err.code });
        flash.set(req, 'danger', err.message);
        return res.redirect('/profile');
      }
      throw err;
    }
    if (isApi(req)) return res.json({ ok: true });
    flash.set(req, 'success', 'Password updated successfully.');
    return res.redirect('/profile');
  }),
];

module.exports = {
  homePathFor,
  getLogin,
  postLogin,
  postLogout,
  getSession,
  getCsrf,
  getProfile,
  postChangePassword,
};
