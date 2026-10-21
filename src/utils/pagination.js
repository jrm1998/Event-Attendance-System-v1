'use strict';

const MAX_LIMIT = 200;

/** Parses ?page & ?limit (and optional ?search passthrough) with bounds. */
function parsePagination(req, defaultLimit = 20) {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(req.query.limit, 10) || defaultLimit));
  return { page, limit, offset: (page - 1) * limit };
}

module.exports = { parsePagination, MAX_LIMIT };
