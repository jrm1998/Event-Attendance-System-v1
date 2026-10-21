'use strict';

const EARTH_RADIUS_METERS = 6371008.8;
const toRad = (deg) => (deg * Math.PI) / 180;

/**
 * Great-circle distance between two WGS84 points, in meters.
 * Approximation: fine for venue-radius checks (error well below 0.5% at
 * school-campus distances) and computed on the server only.
 */
function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
}

module.exports = { haversineDistanceMeters };
