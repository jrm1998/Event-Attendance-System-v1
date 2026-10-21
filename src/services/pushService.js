'use strict';

const webpush = require('web-push');
const config = require('../config/environment');
const notificationRepo = require('../repositories/notificationRepo');
const logger = require('../utils/logger');

let configured = false;
if (config.vapid.publicKey && config.vapid.privateKey) {
  webpush.setVapidDetails(config.vapid.subject, config.vapid.publicKey, config.vapid.privateKey);
  configured = true;
  logger.info('[push] web-push configured with VAPID keys');
} else {
  logger.info('[push] VAPID keys missing; web push disabled (run npm run generate-vapid)');
}

function isConfigured() {
  return configured;
}

function publicKey() {
  return configured ? config.vapid.publicKey : null;
}

/**
 * Sends a push to every active subscription of the user. Subscriptions that
 * answer 404/410 are revoked. Never throws.
 */
async function sendToUser(userId, payload) {
  if (!configured) return 0;
  let subscriptions;
  try {
    subscriptions = await notificationRepo.listActiveSubscriptions(userId);
  } catch (err) {
    logger.error(`[push] subscription lookup failed: ${err.message}`);
    return 0;
  }
  let sent = 0;
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload)
      );
      sent += 1;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await notificationRepo
          .revokeSubscription(userId, sub.endpoint)
          .catch(() => {});
      } else {
        logger.error(`[push] send failed (${err.statusCode || 'no status'}): ${err.message}`);
      }
    }
  }
  return sent;
}

module.exports = { isConfigured, publicKey, sendToUser };
