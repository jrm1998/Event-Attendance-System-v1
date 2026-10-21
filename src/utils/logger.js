'use strict';

const config = require('../config/environment');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[config.logLevel] || LEVELS.info;

function timestamp() {
  return new Date().toISOString();
}

function serialize(args) {
  return args
    .map((a) => {
      if (a instanceof Error) {
        return a.stack || `${a.name}: ${a.message}`;
      }
      if (typeof a === 'object' && a !== null) {
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      }
      return String(a);
    })
    .join(' ');
}

const logger = {
  debug(...args) {
    if (LEVELS.debug >= threshold) console.log(`[${timestamp()}] DEBUG`, serialize(args));
  },
  info(...args) {
    if (LEVELS.info >= threshold) console.log(`[${timestamp()}] INFO`, serialize(args));
  },
  warn(...args) {
    if (LEVELS.warn >= threshold) console.warn(`[${timestamp()}] WARN`, serialize(args));
  },
  error(...args) {
    if (LEVELS.error >= threshold) console.error(`[${timestamp()}] ERROR`, serialize(args));
  },
};

module.exports = logger;
