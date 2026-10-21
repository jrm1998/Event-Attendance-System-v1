'use strict';

const http = require('http');
const config = require('./config/environment');
const { validateEnvironment } = config;
const logger = require('./utils/logger');
const { createApp } = require('./app');
const db = require('./config/database');
const sockets = require('./sockets');

async function main() {
  validateEnvironment();

  const { app, sessionMiddleware } = createApp();
  const server = http.createServer(app);
  const io = sockets.init(server, sessionMiddleware);
  app.set('io', io);

  // Background jobs (absence finalizer, reminders, cleanup) are started
  // separately so they can be disabled in tests.
  let jobsStarted = false;
  if (!config.isTest && process.env.DISABLE_JOBS !== '1') {
    require('./jobs').start();
    jobsStarted = true;
  }

  // Fail loudly in the logs if the database is unreachable at boot — on Render
  // this surfaces a misconfigured DB_HOST/DB_SSL as a clear error instead of
  // mysterious csrf_failure/session errors on every request.
  try {
    await db.query('SELECT 1');
    logger.info(`[db] connected to ${config.db.host}:${config.db.port}/${config.db.database}${config.db.ssl.enabled ? ' (TLS)' : ''}`);
  } catch (err) {
    logger.error(`[db] CANNOT connect to MySQL at ${config.db.host}:${config.db.port}/${config.db.database} — check DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_SSL. ${err.code || err.message}`);
  }

  server.on('error', (err) => {
    logger.error(`HTTP server error: ${err.message}`);
    if (err.code === 'EADDRINUSE') {
      logger.error(`Port ${config.port} is already in use. Stop the other instance or set PORT to a free port.`);
      process.exit(1);
    }
  });

  server.listen(config.port, '0.0.0.0', () => {
    logger.info(`${config.school.name} attendance system listening on port ${config.port} [${config.env}]`);
  });

  let shuttingDown = false;
  const shutdown = (signal, exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received, shutting down...`);

    if (jobsStarted) {
      try {
        require('./jobs').stopAll();
      } catch (err) {
        logger.warn(`Could not stop background jobs: ${err.message}`);
      }
    }

    const finish = async (code) => {
      try {
        await db.end();
      } catch {
        /* pool may already be closed */
      }
      process.exit(code);
    };

    const timer = setTimeout(() => finish(1), 10000);
    timer.unref();

    try {
      io.close();
    } catch {
      /* already closed */
    }
    server.close(() => {
      clearTimeout(timer);
      finish(exitCode);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Backstop: a rejected promise that escaped every handler is a bug, but it
  // must not take the server down mid-session. Log it with context and keep
  // serving; uncaught exceptions are unrecoverable and shut down gracefully.
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection:', reason);
  });
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception, shutting down:', err);
    shutdown('uncaughtException', 1);
  });
}

main().catch((err) => {
  logger.error('Fatal startup error:', err);
  process.exit(1);
});
