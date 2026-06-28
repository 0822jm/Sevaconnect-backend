/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/migrate*.ts', '!src/seed-*.ts', '!src/reset-test-data.ts'],
  setupFiles: ['<rootDir>/jest.setup.js'],
};
