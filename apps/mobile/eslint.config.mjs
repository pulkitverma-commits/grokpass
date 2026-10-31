// Mobile app lint: Expo's config plus the build rules. console.* is an error here (rule 1:
// nothing sensitive is ever logged; use the core's redacting logger instead).
import expoConfig from 'eslint-config-expo/flat.js';
import prettier from 'eslint-config-prettier';

export default [
  ...expoConfig,
  prettier,
  { ignores: ['ios/**', 'android/**', '.expo/**', 'node_modules/**'] },
  { rules: { 'no-console': 'error' } },
  // CommonJS tooling files run under Node.
  { files: ['*.config.js'], languageOptions: { globals: { __dirname: 'readonly', require: 'readonly', module: 'writable', process: 'readonly' } } },
];
