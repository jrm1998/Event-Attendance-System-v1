/**
 * Generates VAPID keys for Web Push notifications.
 *   npm run generate-vapid
 */
const webpush = require('web-push');

const keys = webpush.generateVAPIDKeys();
console.log('Add these to your .env file:\n');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log('VAPID_SUBJECT=mailto:you@example.edu');
