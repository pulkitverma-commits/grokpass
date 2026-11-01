// Component and hook tests for the OnePeek app (jest-expo). Core logic is tested in packages/core
// with vitest; this runner covers React Native screens, hooks and the security module.
// Monorepo note: react-native is installed under apps/mobile/node_modules (React 19) while jest-expo
// and the shared tooling are hoisted to the workspace root (React 18 for the web). Node's lookup from
// the root cannot see react-native, so both trees are added to the resolution path explicitly.
const path = require('node:path');
const Module = require('node:module');
process.env.NODE_PATH = [path.join(__dirname, 'node_modules'), path.join(__dirname, '..', '..', 'node_modules'), process.env.NODE_PATH]
  .filter(Boolean)
  .join(path.delimiter);
Module._initPaths();

/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  // The first transform of ts-mls/@hpke on a cold cache can push a suite past the 5 s default.
  testTimeout: 20000,
  modulePaths: ['<rootDir>/node_modules', '<rootDir>/../../node_modules'],
  // Pin the app's React 19 for everything, including the hoisted reconciler, so one copy renders.
  moduleNameMapper: {
    '^react$': '<rootDir>/node_modules/react',
    '^react/(.*)$': '<rootDir>/node_modules/react/$1',
    '^scheduler$': '<rootDir>/node_modules/scheduler',
    '^scheduler/(.*)$': '<rootDir>/node_modules/scheduler/$1',
    // The sibling workspace package by path, not through node_modules: in an agent worktree the
    // node_modules symlink points at another checkout's packages/core.
    '^@onepeek/core$': '<rootDir>/../../packages/core/src/index.ts',
    '^@onepeek/core/src/(.*)$': '<rootDir>/../../packages/core/src/$1',
  },
  testMatch: ['<rootDir>/**/__tests__/**/*.test.[jt]s?(x)', '<rootDir>/**/*.test.[jt]s?(x)'],
  testPathIgnorePatterns: ['/node_modules/', '/e2e/'],
  // ts-mls and its @hpke / @noble dependencies ship ESM only; anything importing @onepeek/core (lib/chat)
  // needs them compiled, like Metro does for the app.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|react-native-svg|react-native-qrcode-svg|@onepeek/.*|ts-mls|@hpke/.*|@noble/.*)',
  ],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
};
