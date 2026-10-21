'use strict';

const KEY = 'flash';

function set(req, type, message) {
  if (!req.session) return;
  req.session.flash = req.session.flash || [];
  req.session.flash.push({ type, message });
}

function pull(req) {
  if (!req.session || !req.session.flash) return [];
  const messages = req.session.flash;
  req.session.flash = [];
  return messages;
}

module.exports = { set, pull };
