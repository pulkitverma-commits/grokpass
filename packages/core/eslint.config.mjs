// ESLint for @onepeek/core (flat config). Same stack as the root config, but the rules the web
// app only warns on are errors here: this package is new code and is shared with the phones.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ['**/*.{ts,js,mjs}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node, ...globals.es2022 } },
    rules: {
      // Rule 1 of the build: nothing sensitive is ever logged. The core never logs at all.
      'no-console': 'error',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // The platform-neutral core reaches the browser only through the ports in chat/ports.ts.
    files: ['src/chat/**/*.ts', 'src/crypto.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'indexedDB', 'fetch', 'XMLHttpRequest', 'File', 'BroadcastChannel'].map(name => ({
          name,
          message: `${name} is platform-specific; the core must reach it through a port (chat/ports.ts).`,
        })),
      ],
    },
  },
  {
    // The React Native adapters run on Hermes: no DOM. Anything browser-only must stay in adapters/web.
    files: ['src/adapters/rn/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...['window', 'document', 'navigator', 'indexedDB', 'localStorage', 'sessionStorage', 'XMLHttpRequest', 'File', 'Blob'].map(name => ({
          name,
          message: `${name} does not exist on React Native; reach it through a port or the web adapter.`,
        })),
      ],
    },
  },
  {
    // `no-restricted-globals` cannot see `globalThis.window`; close that door in both directories.
    // (`globalThis.fetch` / `globalThis.FileReader` in adapters/rn/platform.ts are deliberate.)
    files: ['src/chat/**/*.ts', 'src/crypto.ts', 'src/adapters/rn/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='globalThis'][property.name=/^(window|document|localStorage|sessionStorage|indexedDB|XMLHttpRequest)$/]",
          message: 'Browser-only global reached through globalThis; the core must go through a port (chat/ports.ts).',
        },
      ],
    },
  },
);
