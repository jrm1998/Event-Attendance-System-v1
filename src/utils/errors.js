'use strict';

class ApiError extends Error {
  constructor(status, message, options = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = options.code || 'error';
    this.details = options.details;
    this.expose = options.expose !== undefined ? options.expose : status < 500;
  }

  static badRequest(message, options) {
    return new ApiError(400, message, { code: 'bad_request', ...options });
  }

  static unauthorized(message = 'Authentication required.', options) {
    return new ApiError(401, message, { code: 'unauthorized', ...options });
  }

  static forbidden(message = 'You do not have permission to perform this action.', options) {
    return new ApiError(403, message, { code: 'forbidden', ...options });
  }

  static notFound(message = 'Not found.', options) {
    return new ApiError(404, message, { code: 'not_found', ...options });
  }

  static conflict(message, options) {
    return new ApiError(409, message, { code: 'conflict', ...options });
  }

  static tooMany(message = 'Too many requests. Please try again later.', options) {
    return new ApiError(429, message, { code: 'too_many_requests', ...options });
  }
}

module.exports = { ApiError };
