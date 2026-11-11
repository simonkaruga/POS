/** Plain Node (no DOM). The integration test needs real PostgreSQL binaries and skips itself without FAIDA_PG_BIN. */
const path = require('path');

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/__tests__'],
  testMatch: ['**/*.test.ts'],
  testTimeout: 120000,
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          esModuleInterop: true,
          skipLibCheck: true,
          types: ['jest', 'node'],
          typeRoots: [path.resolve(__dirname, '../../node_modules/@types')],
        },
      },
    ],
  },
};
