/* global describe, test, expect, __dirname */
// security/backup.ts copies the core's DB_NAME instead of importing it (see the comment there).
// This keeps the two strings equal; read from source so the test needs neither the core's ESM
// dependencies nor Node type definitions in the app's tsconfig.
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), 'utf8');

describe('CHAT_DB_NAME', () => {
  test('equals packages/core DB_NAME', () => {
    const app = read('..', 'backup.ts').match(/export const CHAT_DB_NAME = '([^']+)'/);
    const core = read('..', '..', '..', '..', 'packages', 'core', 'src', 'adapters', 'rn', 'keystore.ts').match(/export const DB_NAME = '([^']+)'/);
    expect(app && app[1]).toBe('onepeek-chat.db');
    expect(core && core[1]).toBe(app && app[1]);
  });
});
