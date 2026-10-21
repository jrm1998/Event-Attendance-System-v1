'use strict';

const logger = require('../utils/logger');

function wantsJson(req) {
  return req.path.startsWith('/api/') || (req.xhr && !req.accepts('html'));
}

function notFoundHandler(req, res) {
  if (wantsJson(req)) {
    return res.status(404).json({ error: 'Not found.', code: 'not_found' });
  }
  res.status(404).render('errors/404', { title: 'Page not found' });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let status = err.status || err.statusCode || 500;
  if (err.name === 'MulterError') {
    status = 400;
    err.message =
      err.code === 'LIMIT_FILE_SIZE'
        ? 'The uploaded file is too large.'
        : 'The upload could not be processed.';
  }
  if (status >= 500) {
    logger.error(`${req.method} ${req.originalUrl} ->`, err);
  } else {
    logger.debug(`${req.method} ${req.originalUrl} -> ${status}: ${err.message}`);
  }

  // Response already started (e.g. streamed export): delegate to Express's
  // default handler, which destroys the socket. Returning here would leave the
  // request hanging forever.
  if (res.headersSent) return next(err);

  if (wantsJson(req)) {
    return res.status(status).json({
      error: err.expose === false || status >= 500 ? 'Something went wrong. Please try again.' : err.message,
      code: err.code || 'error',
      ...(err.details ? { details: err.details } : {}),
    });
  }

  if (status === 401) {
    return res.redirect('/login');
  }
  if (status === 403) {
    return res.status(403).render('errors/403', { title: 'Access denied', message: err.message });
  }
  res.status(status >= 500 ? 500 : status).render('errors/500', {
    title: status >= 500 ? 'Server error' : 'Request failed',
    message: status >= 500 ? 'Something went wrong on our side. Please try again.' : err.message,
  });
}

module.exports = { notFoundHandler, errorHandler };
