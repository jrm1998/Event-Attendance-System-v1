'use strict';

const { haversineDistanceMeters } = require('../utils/haversine');
const { ApiError } = require('../utils/errors');

/**
 * Server-side GPS verification. Browser-supplied coordinates and accuracy
 * are treated as UNTRUSTED input: all distance math and thresholds are
 * computed here, never on the client.
 *
 * Outcomes:
 *  - 'verified'      : within permitted radius -> record attendance normally
 *  - 'flagged'       : outside radius but within flag multiplier -> record as
 *                      pending_review for coordinator approval
 *  - 'rejected'      : throws ApiError(422) with a student-friendly reason
 */
function verifyReading({ event, latitude, longitude, accuracy, clientTimestamp }, gpsConfig) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  const acc = Number(accuracy);

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw ApiError.badRequest('The location reading is invalid. Please retry with GPS enabled.');
  }
  if (!Number.isFinite(acc) || acc < 0) {
    throw ApiError.badRequest('The GPS accuracy reading is invalid. Please retry.');
  }

  const maxAccuracy = Number(event.max_gps_accuracy_meters) || gpsConfig.maxAccuracyMeters;
  if (acc > maxAccuracy) {
    throw ApiError.badRequest(
      `Your GPS accuracy (±${Math.round(acc)} m) is below the required ${maxAccuracy} m. ` +
        'Step into an open area and try again.'
    );
  }

  const timestamp = clientTimestamp ? new Date(clientTimestamp) : new Date();
  if (Number.isNaN(timestamp.getTime())) {
    throw ApiError.badRequest('The location timestamp is invalid. Please retry.');
  }
  const ageSeconds = (Date.now() - timestamp.getTime()) / 1000;
  if (ageSeconds > gpsConfig.freshnessSeconds) {
    throw ApiError.badRequest(
      'Your location reading is too old. Enable location services and submit again.'
    );
  }
  if (ageSeconds < -30) {
    throw ApiError.badRequest('The location timestamp is in the future. Check your device clock and retry.');
  }

  const distance = haversineDistanceMeters(
    Number(event.latitude),
    Number(event.longitude),
    lat,
    lng
  );
  const radius = Number(event.radius_meters) || gpsConfig.defaultRadiusMeters;
  const flagRadius = radius * (gpsConfig.flagDistanceMultiplier || 1.5);

  if (distance <= radius) {
    return {
      outcome: 'verified',
      distance: Number(distance.toFixed(2)),
      accuracy: Number(acc.toFixed(2)),
      radius,
      maxAccuracy,
    };
  }
  if (distance <= flagRadius) {
    return {
      outcome: 'flagged',
      distance: Number(distance.toFixed(2)),
      accuracy: Number(acc.toFixed(2)),
      radius,
      maxAccuracy,
      reason:
        `Measured ${Math.round(distance)} m from the venue (permitted ${radius} m). ` +
        'Submission queued for coordinator review.',
    };
  }
  throw ApiError.badRequest(
    `You appear to be ${Math.round(distance)} m away from the venue. ` +
      `Attendance requires you to be within ${radius} m of ${event.venue_name}. ` +
      'If you believe this is wrong, ask the event coordinator for a manual check-in.'
  );
}

module.exports = { verifyReading };
