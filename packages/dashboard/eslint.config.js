// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from "eslint-plugin-storybook";

import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tsParser from '@typescript-eslint/parser'
import designLint from '@vendure-io/design-lint/eslint'

export default [{
  // Generated / build / test-fixture artifacts (all gitignored) — never source, so
  // never linted. storybook-static and __temp fixtures are bundled/minified output
  // that otherwise produces ~12.8k false-positive errors.
  // fake_node_modules dirs are transpiled test fixtures simulating installed npm
  // packages — like real node_modules (default-ignored), they aren't ours to lint.
  ignores: ['dist', 'storybook-static', '.temp', 'coverage', '**/__temp/**', '**/fake_node_modules/**'],
}, {
  files: ['src/**/*.{ts,tsx,js,jsx}'],
  // Spec files are excluded: issue references like "(#2608)" in test titles are
  // false-positive hex colors, and excluding them beats scattering disable
  // comments through test suites.
  ignores: ['src/**/*.spec.{ts,tsx}'],
  languageOptions: {
    parser: tsParser,
    parserOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      ecmaFeatures: { jsx: true },
    },
  },
  plugins: {
    '@vendure-io/design': designLint,
  },
  rules: {
    '@vendure-io/design/no-raw-colors': 'error',
  },
}, {
  files: ['**/*.{js,jsx}'],
  languageOptions: {
    ecmaVersion: 2020,
    // These are Node build/tooling scripts (scripts/, .storybook/, *.config.js),
    // not browser code — they use process, require, __dirname, etc.
    globals: { ...globals.node, ...globals.browser },
    parserOptions: {
      ecmaVersion: 'latest',
      ecmaFeatures: { jsx: true },
      sourceType: 'module',
    },
  },
  settings: { react: { version: '18.3' } },
  plugins: {
    react,
    'react-hooks': reactHooks,
    'react-refresh': reactRefresh,
  },
  rules: {
    ...js.configs.recommended.rules,
    ...react.configs.recommended.rules,
    ...react.configs['jsx-runtime'].rules,
    ...reactHooks.configs.recommended.rules,
    'react/jsx-no-target-blank': 'off',
    // Underscore-prefixed args/vars are intentionally unused (conventional escape hatch).
    'no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
    ],
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
  },
}, {
  // Storybook TS config files live outside src/, so they need the TS parser to
  // avoid "Parsing error: Unexpected token" on type-only syntax.
  files: ['.storybook/**/*.{ts,tsx}'],
  languageOptions: {
    parser: tsParser,
    parserOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      ecmaFeatures: { jsx: true },
    },
  },
}, ...storybook.configs["flat/recommended"]];
