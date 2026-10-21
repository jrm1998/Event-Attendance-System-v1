'use strict';

import { describe, it, expect } from 'vitest';
const gpsService = require('../../src/services/gpsService');

const GPS_CONFIG = {
  defaultRadiusMeters: 50,
  maxAccuracyMeters: 50,
  freshnessSeconds: 120,
  flagDistanceMultiplier: 1.5,
};

const VENUE = { latitude: 14.599512, longitude: 120.984222, radius_meters: 50, venue_name: 'Main Gym' };

function readingAt(distanceMeters, overrides = {}) {
  // Walk due north: 1° latitude ≈ 110,574 m.
  const dLat = distanceMeters / 110574;
  return {
    event: VENUE,
    latitude: VENUE.latitude + dLat,
    longitude: VENUE.longitude,
    accuracy: 10,
    clientTimestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('gpsService.verifyReading', () => {
  it('verifies a reading inside the radius', () => {
    const result = gpsService.verifyReading(readingAt(30), GPS_CONFIG);
    expect(result.outcome).toBe('verified');
    expect(result.distance).toBeLessThanOrEqual(50);
  });

  it('verifies a reading exactly at the venue', () => {
    const result = gpsService.verifyReading(readingAt(0), GPS_CONFIG);
    expect(result.outcome).toBe('verified');
    expect(result.distance).toBeLessThan(2);
  });

  it('flags a reading between radius and radius × multiplier', () => {
    const result = gpsService.verifyReading(readingAt(65), GPS_CONFIG);
    expect(result.outcome).toBe('flagged');
    expect(result.reason).toMatch(/review/i);
    expect(result.distance).toBeGreaterThan(50);
    expect(result.distance).toBeLessThanOrEqual(75);
  });

  it('rejects a reading beyond radius × multiplier with a 422-class error', () => {
    expect(() => gpsService.verifyReading(readingAt(200), GPS_CONFIG)).toThrowError(/away from the venue/i);
  });

  it('rejects readings less accurate than the event maximum', () => {
    expect(() => gpsService.verifyReading(readingAt(10, { accuracy: 120 }), GPS_CONFIG)).toThrowError(
      /accuracy/i
    );
  });

  it('honors a stricter per-event accuracy cap', () => {
    expect(() =>
      gpsService.verifyReading(
        readingAt(10, { accuracy: 40, event: { ...VENUE, max_gps_accuracy_meters: 20 } }),
        GPS_CONFIG
      )
    ).toThrowError(/accuracy/i);
    const ok = gpsService.verifyReading(
      readingAt(10, { accuracy: 15, event: { ...VENUE, max_gps_accuracy_meters: 20 } }),
      GPS_CONFIG
    );
    expect(ok.outcome).toBe('verified');
    expect(ok.maxAccuracy).toBe(20);
  });

  it('rejects stale readings past the freshness window', () => {
    const stale = new Date(Date.now() - (GPS_CONFIG.freshnessSeconds + 30) * 1000).toISOString();
    expect(() => gpsService.verifyReading(readingAt(10, { clientTimestamp: stale }), GPS_CONFIG)).toThrowError(
      /too old/i
    );
  });

  it('rejects future timestamps beyond a 30s clock skew', () => {
    const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    expect(() => gpsService.verifyReading(readingAt(10, { clientTimestamp: future }), GPS_CONFIG)).toThrowError(
      /future/i
    );
  });

  it('accepts small clock skew', () => {
    const slightlyAhead = new Date(Date.now() + 10 * 1000).toISOString();
    const result = gpsService.verifyReading(readingAt(10, { clientTimestamp: slightlyAhead }), GPS_CONFIG);
    expect(result.outcome).toBe('verified');
  });

  it('rejects malformed coordinates', () => {
    expect(() =>
      gpsService.verifyReading(readingAt(10, { latitude: 'not-a-number' }), GPS_CONFIG)
    ).toThrowError(/invalid/i);
    expect(() => gpsService.verifyReading(readingAt(10, { longitude: 999 }), GPS_CONFIG)).toThrowError(
      /invalid/i
    );
    expect(() => gpsService.verifyReading(readingAt(10, { accuracy: -5 }), GPS_CONFIG)).toThrowError(
      /accuracy/i
    );
  });

  it('falls back to configured radius when the event lacks one', () => {
    const result = gpsService.verifyReading(
      readingAt(65, { event: { ...VENUE, radius_meters: null } }),
      GPS_CONFIG
    );
    expect(result.outcome).toBe('flagged');
    expect(result.radius).toBe(50);
  });
});
