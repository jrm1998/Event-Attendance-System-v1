'use strict';

const express = require('express');
const path = require('path');
const helmet = require('helmet');
const config = require('./config/environment');
const db = require('./config/database');
const createSessionMiddleware = require('./config/session');
const csrfMiddleware = require('./middleware/csrf');
const { attachUser } = require('./middleware/authenticate');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const { apiLimiter } = require('./middleware/rateLimiter');
const flash = require('./utils/flash');
const timeUtils = require('./utils/time');
const settingsService = require('./services/settingsService');
const routes = require('./routes');

const nodeModules = path.join(__dirname, '..', 'node_modules');
const oneDay = { maxAge: 24 * 60 * 60 * 1000, immutable: false };

function createApp() {
  const app = express();
  const sessionMiddleware = createSessionMiddleware();

  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');
  app.set('view engine', 'ejs');
  app.set('views', config.viewsDir);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          mediaSrc: ["'self'", 'blob:'],
          connectSrc: ["'self'", 'wss:', 'ws:'],
          workerSrc: ["'self'", 'blob:'],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          frameAncestors: ["'self'"],
          formAction: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
      referrerPolicy: { policy: 'same-origin' },
    })
  );

  // Liveness/readiness probe for Render (and any other orchestrator). Placed
  // before the session middleware so health checks never touch the session
  // store; verifies real database connectivity without exposing any details.
  app.get('/health', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      await db.query('SELECT 1');
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  // Static assets are mounted BEFORE the session middleware: otherwise every
  // CSS/JS/icon request with a session cookie triggered a user lookup in MySQL.
  app.use('/vendor/bootstrap', express.static(path.join(nodeModules, 'bootstrap', 'dist'), oneDay));
  app.use('/vendor/bootstrap-icons', express.static(path.join(nodeModules, 'bootstrap-icons'), oneDay));
  app.use('/vendor/chartjs', express.static(path.join(nodeModules, 'chart.js', 'dist'), oneDay));
  app.use('/vendor/html5-qrcode', express.static(path.join(nodeModules, 'html5-qrcode'), oneDay));
  app.use('/vendor/socket.io', express.static(path.join(nodeModules, 'socket.io', 'client-dist'), oneDay));

  app.use(
    express.static(config.publicDir, {
      maxAge: oneDay.maxAge,
      setHeaders(res, filePath) {
        if (filePath.endsWith('service-worker.js') || filePath.endsWith('.webmanifest')) {
          res.setHeader('Cache-Control', 'no-cache');
        }
        if (filePath.endsWith('offline.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    })
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  app.use(sessionMiddleware);
  app.use(csrfMiddleware);
  app.use(attachUser);

  app.use(async (req, res, next) => {
    res.locals.currentUser = req.user || null;
    try {
      res.locals.schoolName = await settingsService.getSchoolName();
    } catch {
      // Settings are cached; if the DB is unreachable, pages still render
      // with the environment fallback rather than failing the whole request.
      res.locals.schoolName = config.school.name;
    }
    res.locals.timezone = config.school.timezone;
    res.locals.currentPath = req.path;
    res.locals.fmt = {
      dt: timeUtils.formatDateTime,
      t: timeUtils.formatTime,
      local: timeUtils.formatDatetimeLocal,
    };
    res.locals.query = req.query || {};
    res.locals.flashes = flash.pull(req);
    next();
  });

  // Dynamic responses (pages + APIs) are session-personalized and must never
  // be cached anywhere; static mounts above keep their own cache headers.
  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use('/api', apiLimiter, routes.api);
  app.use('/', routes.pages);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return { app, sessionMiddleware };
}

module.exports = { createApp };
