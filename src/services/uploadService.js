'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config/environment');
const { ApiError } = require('../utils/errors');

fs.mkdirSync(config.uploadsDir, { recursive: true });

const IMAGE_MIMES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const MAGIC_BYTES = [
  { bytes: [0xff, 0xd8, 0xff], mime: 'image/jpeg' },
  { bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], mime: 'image/png' },
  {
    bytes: [0x52, 0x49, 0x46, 0x46],
    check: [0x57, 0x45, 0x42, 0x50],
    checkOffset: 8,
    mime: 'image/webp',
  },
];

function imageFileFilter(req, file, cb) {
  if (!IMAGE_MIMES[file.mimetype]) {
    return cb(ApiError.badRequest('Only JPEG, PNG, or WebP images are allowed.'));
  }
  cb(null, true);
}

function makeImageUpload(fieldName, sizeLimitMb = 5) {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, config.uploadsDir),
    filename: (req, file, cb) => {
      const ext = IMAGE_MIMES[file.mimetype] || '.bin';
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
    },
  });
  return multer({
    storage,
    fileFilter: imageFileFilter,
    limits: { fileSize: sizeLimitMb * 1024 * 1024, files: 1 },
  });
}

/**
 * Verifies uploaded content by magic bytes — defends against a renamed
 * executable or HTML smuggled with an image Content-Type.
 */
function matches(head, offset, bytes) {
  const slice = head.subarray(offset, offset + bytes.length);
  return slice.length === bytes.length && slice.every((b, i) => b === bytes[i]);
}

function verifyImageMagic(filePath) {
  return new Promise((resolve, reject) => {
    let fd;
    try {
      fd = fs.openSync(filePath, 'r');
      const buffer = Buffer.alloc(16);
      const read = fs.readSync(fd, buffer, 0, 16, 0);
      const head = buffer.subarray(0, read);
      for (const sig of MAGIC_BYTES) {
        if (!matches(head, sig.offset || 0, sig.bytes)) continue;
        if (sig.check && !matches(head, sig.checkOffset || 0, sig.check)) continue;
        return resolve(sig.mime);
      }
      return reject(ApiError.badRequest('File content is not a valid image.'));
    } catch (err) {
      return reject(err);
    } finally {
      if (fd !== undefined) {
        try {
          fs.closeSync(fd);
        } catch {
          /* already closed */
        }
      }
    }
  });
}

function deleteQuietly(filePath) {
  if (!filePath) return;
  // Accepts either an absolute path from multer or a /uploads/... web path.
  const full = path.join(config.uploadsDir, path.basename(filePath));
  fs.promises.unlink(full).catch(() => {});
}

/** Public web path for a stored upload filename. */
function publicPath(filename) {
  return `/uploads/${path.basename(filename)}`;
}

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter(req, file, cb) {
    const ok = ['.csv', '.xlsx'].includes(path.extname(file.originalname || '').toLowerCase());
    if (!ok) return cb(ApiError.badRequest('Upload a .csv or .xlsx file.'));
    cb(null, true);
  },
});

module.exports = { makeImageUpload, verifyImageMagic, deleteQuietly, publicPath, importUpload };
