import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    testTimeout: 15000,
    hookTimeout: 30000,
    // Database-backed integration tests self-skip when TEST_DB_HOST is not set
    // so `npm test` works on machines without MySQL.
    env: {
      TZ: 'UTC',
    },
  },
});
