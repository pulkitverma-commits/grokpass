// Root ESLint (flat config). The web app predates linting, so rules that the existing code
// does not satisfy are warnings here; apps/mobile and packages/core run them as errors.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import next from '@next/eslint-plugin-next';

export default tseslint.config(
  { ignores: ['node_modules/**', '.next/**', 'apps/**', 'packages/**', 'public/sw.js', 'next-env.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ['**/*.{ts,tsx,js,mjs}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node, ...globals.es2022 } },
    plugins: { 'react-hooks': reactHooks, '@next/next': next },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...next.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      '@typescript-eslint/no-unused-expressions': 'warn',
      '@typescript-eslint/ban-ts-comment': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-useless-escape': 'warn',
      'prefer-const': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/rules-of-hooks': 'warn',
      // Rule 1 of the build: nothing sensitive is ever logged. New code must not call console.*
      // at all outside server routes; the web app's existing calls are grandfathered as warnings.
      'no-console': 'warn',
    },
  },
);
