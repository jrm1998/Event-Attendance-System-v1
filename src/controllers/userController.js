'use strict';

const { validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../config/database');
const userRepo = require('../repositories/userRepo');
const structureValidator = require('../validators/structureValidator');
const auditService = require('../services/auditService');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/errors');
const { parsePagination } = require('../utils/pagination');

async function listPage(req, res) {
  const { page, limit, offset } = parsePagination(req);
  const { rows, total } = await userRepo.listUsers({
    role: req.query.role || null,
    status: req.query.status || null,
    search: req.query.search || null,
    limit,
    offset,
  });
  res.render('admin/users', {
    title: 'Users & Teachers',
    users: rows,
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    filters: { role: req.query.role || '', status: req.query.status || '', search: req.query.search || '' },
  });
}

const createApi = [
  ...structureValidator.createUser,
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) throw ApiError.badRequest(errors.array({ onlyFirstError: true })[0].msg);
    const { role, username, email, password, firstName, lastName, employeeNumber } = req.body;

    if (await userRepo.usernameExists(username)) {
      throw ApiError.conflict('That username is already taken.');
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const userId = await userRepo.createUser({ username, email: email || null, passwordHash, role }, conn);
      if (role === 'teacher') {
        await conn.query(
          'INSERT INTO teachers (user_id, employee_number, first_name, last_name, status) VALUES (?, ?, ?, ?, "active")',
          [userId, employeeNumber, firstName, lastName]
        );
      }
      await conn.commit();
      await auditService.logAdminAction(req, `user.create_${role}`, 'user', userId, { username, role });
      res.status(201).json({ ok: true, id: userId });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }),
];

const updateStatusApi = [
  ...structureValidator.updateUserStatus,
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) throw ApiError.badRequest(errors.array()[0].msg);
    const id = Number.parseInt(req.params.id, 10);
    if (id === req.user.id && req.body.status !== 'active') {
      throw ApiError.badRequest('You cannot deactivate your own account.');
    }
    await userRepo.updateStatus(id, req.body.status);
    await auditService.logAdminAction(req, 'user.update_status', 'user', id, { status: req.body.status });
    res.json({ ok: true });
  }),
];

const resetPasswordApi = [
  ...structureValidator.resetPassword,
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) throw ApiError.badRequest(errors.array()[0].msg);
    const id = Number.parseInt(req.params.id, 10);
    const newPassword =
      req.body.newPassword ||
      `${crypto.randomBytes(4).toString('hex').toUpperCase()}!Aa${new Date().getFullYear()}`;
    const hash = await bcrypt.hash(newPassword, 12);
    await userRepo.updatePassword(id, hash);
    await auditService.logAdminAction(req, 'user.reset_password', 'user', id, {});
    res.json({ ok: true, generated: req.body.newPassword ? null : newPassword });
  }),
];

module.exports = { listPage, createApi, updateStatusApi, resetPasswordApi };
