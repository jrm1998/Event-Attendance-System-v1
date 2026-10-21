'use strict';

import { describe, it, expect } from 'vitest';
const bcrypt = require('bcryptjs');
const authService = require('../../src/services/authService');
const { validateEnvironment } = require('../../src/config/environment');

describe('password policy', () => {
  it('accepts a strong password', () => {
    expect(() => authService.validatePasswordStrength('CorrectHorse9')).not.toThrow();
  });

  it('rejects short, weak and missing character classes', () => {
    expect(() => authService.validatePasswordStrength('Ab1')).toThrowError(/10 characters/i);
    expect(() => authService.validatePasswordStrength('alllowercase1')).toThrowError(/uppercase/i);
    expect(() => authService.validatePasswordStrength('ALLUPPERCASE1')).toThrowError(/lowercase/i);
    expect(() => authService.validatePasswordStrength('NoDigitsHere')).toThrowError(/digit/i);
    expect(() => authService.validatePasswordStrength(null)).toThrowError();
    expect(() => authService.validatePasswordStrength(undefined)).toThrowError();
  });
});

describe('password hashing', () => {
  it('produces a salted bcrypt hash that verifies', async () => {
    const hash = await bcrypt.hash('CorrectHorse9', 10);
    expect(hash).toMatch(/^\$2[aby]\$/);
    expect(await bcrypt.compare('CorrectHorse9', hash)).toBe(true);
    expect(await bcrypt.compare('WrongPassword1', hash)).toBe(false);
  });

  it('uses unique salts for identical passwords', async () => {
    const a = await bcrypt.hash('SamePassword1', 10);
    const b = await bcrypt.hash('SamePassword1', 10);
    expect(a).not.toBe(b);
  });
});

describe('environment validation (production guard rails)', () => {
  const ORIGINAL_ENV = { ...process.env };

  function withEnv(overrides, fn) {
    process.env = { ...ORIGINAL_ENV, ...overrides };
    try {
      fn();
    } finally {
      process.env = ORIGINAL_ENV;
    }
  }

  it('requires a 32+ char SESSION_SECRET in production', () => {
    withEnv({ NODE_ENV: 'production', SESSION_SECRET: 'short', COOKIE_SECURE: 'true' }, () => {
      expect(() => validateEnvironment()).toThrowError(/SESSION_SECRET/);
    });
    withEnv({ NODE_ENV: 'production', SESSION_SECRET: undefined, COOKIE_SECURE: 'true' }, () => {
      expect(() => validateEnvironment()).toThrowError(/SESSION_SECRET/);
    });
  });

  it('requires COOKIE_SECURE in production', () => {
    // Clear VITEST so the config's test-mode bypass is inactive, mirroring a
    // real production boot. config.session.cookieSecure defaults to false
    // when the module loaded outside production.
    withEnv(
      {
        NODE_ENV: 'production',
        SESSION_SECRET: 'x'.repeat(40),
        COOKIE_SECURE: 'false',
        VITEST: '',
      },
      () => {
        expect(() => validateEnvironment()).toThrowError(/COOKIE_SECURE/);
      }
    );
  });

  it('accepts a valid production configuration', () => {
    withEnv(
      {
        NODE_ENV: 'production',
        SESSION_SECRET: 'x'.repeat(40),
        COOKIE_SECURE: 'true',
        DB_NAME: 'school_attendance',
      },
      () => {
        expect(() => validateEnvironment()).not.toThrow();
      }
    );
  });
});
