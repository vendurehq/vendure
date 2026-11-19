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
  ignores: ['dist', 'storybook-static', '.temp', 'coverage', '**/__temp/**', '**/fake_node_modules/**', 'e2e/.dist'],
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
    // A link row built by hand (a router Link or an anchor with its own hover
    // fill) misses the row height, focus ring and "opens" chevron of the design
    // system. Build the row with ListRow + ListRowLink, or DataTableRowLink in a
    // table. Only a plain className string is checked: a cn() call also builds
    // menu items (the collapsed sidebar flyout), which are not rows. Belongs in
    // @vendure-io/design-lint once it has a rule for it.
    'no-restricted-syntax': [
      'error',
      ...[
        "JSXOpeningElement[name.name=/^(Link|a)$/] > JSXAttribute[name.name='className'] > Literal[value=/(^|\\s)hover:bg-/]",
        "JSXOpeningElement[name.name=/^(Link|a)$/] > JSXAttribute[name.name='className'] > JSXExpressionContainer > TemplateLiteral > TemplateElement[value.raw=/(^|\\s)hover:bg-/]",
      ].map(selector => ({
        selector,
        message: 'A link row is ListRow + ListRowLink, or DataTableRowLink in a table. Do not give a Link or <a> its own hover fill.',
      })),
      // A Badge with its own button is a hand-made removable tag. Chip owns the
      // remove button, its hover, focus ring and accessible name.
      {
        selector:
          "JSXElement[openingElement.name.name='Badge'] JSXElement[openingElement.name.name=/^(button|Button)$/]",
        message: 'A removable tag is Chip with onRemove and removeLabel, not a Badge with its own button.',
      },
      // Label/value lists use the design-system DescriptionList, not hand-built dl/dt/dd.
      {
        selector: 'JSXOpeningElement[name.name=/^(dl|dt|dd)$/]',
        message: 'Use DescriptionList, DescriptionItem or DescriptionListItem from @/vdb/components/ui/description-list.js.',
      },
      // A hand-drawn spinner keeps turning under reduced motion and has no
      // role or name. Spinner and LoadingState own both.
      ...[
        "JSXAttribute[name.name='className'] Literal[value=/(^|\\s)animate-spin(\\s|$)/]",
        "JSXAttribute[name.name='className'] TemplateElement[value.raw=/(^|\\s)animate-spin(\\s|$)/]",
      ].map(selector => ({
        selector,
        message: 'Use Spinner from @/vdb/components/ui/spinner.js, or LoadingState variant="spinner" for a loading region. Do not spin an icon or a border with animate-spin.',
      })),
      // Shortcut hints use the design-system Kbd, which styles the key for
      // tooltips and keeps key names left to right in RTL pages.
      {
        selector: "JSXOpeningElement[name.name='kbd']",
        message: 'Use Kbd or KbdGroup from @/vdb/components/ui/kbd.js, not a raw <kbd>.',
      },
    ],
  },
}, {
  // OSS-1380 follow-up: these two files still draw a spinner (variants) and a
  // raw kbd (nav-main). Other lanes hold them (OSS-1401, OSS-1385). Remove this
  // block once they use Spinner and Kbd.
  files: [
    'src/lib/components/layout/nav-main.tsx',
    'src/app/routes/_authenticated/_products/products_.$id_.variants.tsx',
  ],
  rules: {
    'no-restricted-syntax': 'off',
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
