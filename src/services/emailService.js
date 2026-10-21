'use strict';

const nodemailer = require('nodemailer');
const config = require('../config/environment');
const logger = require('../utils/logger');

let transport = null;
if (config.smtp.enabled && config.smtp.host) {
  transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
  logger.info(`[email] SMTP transport configured for ${config.smtp.host}:${config.smtp.port}`);
} else {
  logger.info('[email] SMTP disabled; email notifications will be skipped');
}

function isConfigured() {
  return !!transport;
}

/**
 * Sends an email. Never throws — email is best-effort and must not break
 * the calling request or job.
 */
async function sendMail({ to, subject, text, html }) {
  if (!transport) {
    logger.info(`[email] skipped (disabled): "${subject}" to ${to ? 'recipient' : 'no recipient'}`);
    return false;
  }
  if (!to) return false;
  try {
    await transport.sendMail({
      from: config.smtp.from,
      to,
      subject: String(subject).slice(0, 200),
      text: text || '',
      html: html || undefined,
    });
    return true;
  } catch (err) {
    logger.error(`[email] send failed: ${err.message}`);
    return false;
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Small branded HTML wrapper for notification emails. */
function wrapHtml(title, bodyText, schoolName = config.school.name) {
  const escaped = escapeHtml(bodyText);
  return (
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;">' +
    `<h2 style="color:#1a3a5c;font-size:18px;margin:16px 0 4px;">${escapeHtml(schoolName)}</h2>` +
    `<p style="font-size:14px;font-weight:bold;margin:0 0 12px;">${escapeHtml(title)}</p>` +
    `<p style="font-size:14px;line-height:1.5;margin:0 0 16px;">${escaped.replace(/\n/g, '<br>')}</p>` +
    '<p style="font-size:11px;color:#888;">Automated message from the school attendance system. ' +
    'Do not reply to this email.</p>' +
    '</div>'
  );
}

module.exports = { isConfigured, sendMail, wrapHtml };
