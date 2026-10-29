import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', '.wrangler', 'worker-configuration.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['src/**'], languageOptions: { globals: globals.browser } },
  { files: ['worker/**'], languageOptions: { globals: globals.serviceworker } },
  { files: ['*.config.*'], languageOptions: { globals: globals.node } },
  {
    // Legacy single-file game: only catch real breakage (undeclared vars break in strict ES modules).
    files: ['src/legacy/**'],
    rules: { 'no-undef': 'error', '@typescript-eslint/no-unused-expressions': 'off', 'no-unused-vars': 'off', '@typescript-eslint/no-unused-vars': 'off', 'no-empty': 'off', 'no-cond-assign': 'off', 'no-fallthrough': 'off', 'prefer-const': 'off', 'no-sparse-arrays': 'off' },
  },
);
