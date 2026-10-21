'use strict';

import { describe, it, expect } from 'vitest';
const qrService = require('../../src/services/qrService');
const { randomToken, sha256Hex, safeHexEqual } = require('../../src/utils/tokens');
const { ApiError } = require('../../src/utils/errors');

describe('qrService.parsePayload (structural parse)', () => {
  it('parses a well-formed payload and hashes the token', () => {
    const payload = `ATT:12:${randomToken(32)}`;
    const parsed = qrService.parsePayload(payload);
    expect(parsed.eventId).toBe(12);
    expect(parsed.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects payloads with the wrong prefix', () => {
    expect(() => qrService.parsePayload('XYZ:1:token')).toThrowError(/not a valid attendance QR/i);
  });

  it('rejects payloads with the wrong segment count', () => {
    expect(() => qrService.parsePayload('ATT:1')).toThrowError(/not a valid attendance QR/i);
    expect(() => qrService.parsePayload('ATT:1:token:extra')).toThrowError(/not a valid attendance QR/i);
  });

  it('rejects non-numeric event ids', () => {
    expect(() => qrService.parsePayload('ATT:abc:token')).toThrowError(/malformed/i);
    expect(() => qrService.parsePayload('ATT:0:token')).toThrowError(/malformed/i);
    expect(() => qrService.parsePayload('ATT:-3:token')).toThrowError(/malformed/i);
  });

  it('rejects empty input', () => {
    expect(() => qrService.parsePayload('')).toThrowError();
    expect(() => qrService.parsePayload(null)).toThrowError();
    expect(() => qrService.parsePayload(undefined)).toThrowError();
  });

  it('produces identical hashes for identical tokens and different hashes otherwise', () => {
    const token = randomToken(32);
    const a = qrService.parsePayload(`ATT:1:${token}`);
    const b = qrService.parsePayload(`ATT:2:${token}`);
    const c = qrService.parsePayload(`ATT:1:${randomToken(32)}`);
    expect(a.tokenHash).toBe(b.tokenHash);
    expect(a.tokenHash).not.toBe(c.tokenHash);
  });
});

describe('validateScannedPayload exposure', () => {
  it('is an async function (DB-backed; covered by integration tests)', () => {
    expect(typeof qrService.validateScannedPayload).toBe('function');
    expect(qrService.validateScannedPayload.constructor.name).toBe('AsyncFunction');
  });
});

describe('token utilities', () => {
  it('generates URL-safe tokens of expected entropy', () => {
    const token = randomToken(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]{42,44}$/);
    expect(randomToken(32)).not.toBe(token);
  });

  it('hashes deterministically to 64 hex chars', () => {
    expect(sha256Hex('abc')).toBe(sha256Hex('abc'));
    expect(sha256Hex('abc')).toMatch(/^[a-f0-9]{64}$/);
  });

  it('compares hex digests in constant time and fails closed', () => {
    const h = sha256Hex('secret');
    expect(safeHexEqual(h, h)).toBe(true);
    expect(safeHexEqual(h, sha256Hex('other'))).toBe(false);
    expect(safeHexEqual(h, '')).toBe(false);
    expect(safeHexEqual(null, h)).toBe(false);
  });
});

describe('ApiError helpers used by the scan flow', () => {
  it('exposes status codes for bad requests', () => {
    const err = ApiError.badRequest('nope');
    expect(err.status).toBe(400);
  });
});
