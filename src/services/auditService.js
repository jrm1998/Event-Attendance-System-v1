'use strict';

const auditRepo = require('../repositories/auditRepo');

/** Fire-and-forget administrative audit entry. */
function logAdminAction(req, action, entityType, entityId, details) {
  if (!req.user) return Promise.resolve();
  return auditRepo.log({
    actorUserId: req.user.id,
    action,
    entityType,
    entityId,
    details,
    ipAddress: req.ip,
  });
}

module.exports = { logAdminAction };
