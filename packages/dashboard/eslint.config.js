// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from "eslint-plugin-storybook";

import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tsParser from '@typescript-eslint/parser'
import designLint from '@vendure-io/design-lint/eslint'
import { builtinRules } from 'eslint/use-at-your-own-risk'

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
      // transition-all also animates layout properties, and a numeric duration
      // or delay skips the motion tokens. List the properties that change
      // (transition-[box-shadow]) and use duration-fast, ease-default and the
      // other motion tokens. Any string is checked, so cn() arguments count too.
      // Belongs in @vendure-io/design-lint once it has a rule for it.
      ...[
        'Literal[value=/(^|[\\s:])transition-all(\\s|$)|(^|[\\s:])(duration|delay)-\\d+(\\s|$)/]',
        'TemplateElement[value.raw=/(^|[\\s:])transition-all(\\s|$)|(^|[\\s:])(duration|delay)-\\d+(\\s|$)/]',
      ].map(selector => ({
        selector,
        message: 'List the transition properties instead of transition-all, and use a motion token (duration-fast, duration-normal, ease-default…) instead of a numeric duration or delay.',
      })),
      // An icon-only Button has no text, so a screen reader announces it only as
      // "button". Name it with aria-label, with the row's name where there is a
      // row ("Actions for Laptop"). A tooltip does not name it.
      {
        selector:
          "JSXOpeningElement[name.name='Button']:has(> JSXAttribute[name.name='size'][value.value=/^icon/]):not(:has(> JSXAttribute[name.name=/^aria-label(ledby)?$/]))",
        message: 'An icon-only Button needs an accessible name. Add aria-label={t`…`}.',
      },
    ],
  },
}, {
  // Status markers come from the design system: TimelineMarker (a feed or a
  // step list) or StatusBadge (a single state), with a state-dictionary tone.
  // Warn on a small round element in a tone colour drawn by hand, and on the
  // colour-class marker prop of HistoryEntry. Expect the odd false positive.
  // A second copy of no-restricted-syntax under its own name, so this warning
  // does not replace the link-row selectors above.
  files: ['src/**/*.tsx'],
  ignores: ['src/**/*.spec.tsx', 'src/**/*.stories.tsx', 'src/lib/components/ui/**'],
  plugins: {
    'status-marker': { rules: { 'no-restricted-syntax': builtinRules.get('no-restricted-syntax') } },
  },
  rules: {
    'status-marker/no-restricted-syntax': [
      'warn',
      {
        selector:
          "JSXAttribute[name.name='className'] :matches(Literal[value=/\\brounded-full\\b/][value=/(^|\\s)(size|h)-[2-7](\\s|$)/][value=/(^|[\\s:])(bg|border)-(success|warning|destructive|info)/], TemplateElement[value.raw=/\\brounded-full\\b/][value.raw=/(^|\\s)(size|h)-[2-7](\\s|$)/][value.raw=/(^|[\\s:])(bg|border)-(success|warning|destructive|info)/])",
        message:
          'Hand-drawn status marker. Use TimelineMarker or StatusBadge with a state-dictionary tone.',
      },
      {
        selector: ":matches(JSXAttribute[name.name='timelineIconClassName'], ObjectExpression > Property[key.name='timelineIconClassName'])",
        message: 'timelineIconClassName is deprecated. Pass a state-dictionary `tone` to HistoryEntry.',
      },
    ],
  },
}, {
  // A hand-drawn spinner keeps turning under reduced motion and has no role or
  // name: Spinner and LoadingState own both. Shortcut hints use Kbd, which
  // styles the key for tooltips and keeps key names left to right in RTL pages.
  // A copy of no-restricted-syntax under its own name, so these errors do not
  // replace the selectors above.
  files: ['src/**/*.tsx'],
  ignores: [
    'src/**/*.spec.tsx',
    'src/lib/components/ui/**',
  ],
  plugins: {
    'design-primitives': { rules: { 'no-restricted-syntax': builtinRules.get('no-restricted-syntax') } },
  },
  rules: {
    'design-primitives/no-restricted-syntax': [
      'error',
      ...[
        "JSXAttribute[name.name='className'] Literal[value=/(^|\\s)animate-spin(\\s|$)/]",
        "JSXAttribute[name.name='className'] TemplateElement[value.raw=/(^|\\s)animate-spin(\\s|$)/]",
      ].map(selector => ({
        selector,
        message: 'Use Spinner from @/vdb/components/ui/spinner.js, or LoadingState variant="spinner" for a loading region. Do not spin an icon or a border with animate-spin.',
      })),
      {
        selector: "JSXOpeningElement[name.name='kbd']",
        message: 'Use Kbd or KbdGroup from @/vdb/components/ui/kbd.js, not a raw <kbd>.',
      },
      // A heading sets its own size or weight instead of a title role, so its
      // size, tracking and line height differ from the page, card and dialog
      // titles around it. Any string in the className counts, so cn() arguments
      // are checked too. Belongs in @vendure-io/design-lint once it has a rule
      // for it.
      ...[
        'Literal[value=/(^|[\\s:])(text-(xs|sm|base|lg|xl|[2-9]xl)|font-(medium|semibold|bold))(\\s|$)/]',
        'TemplateElement[value.raw=/(^|[\\s:])(text-(xs|sm|base|lg|xl|[2-9]xl)|font-(medium|semibold|bold))(\\s|$)/]',
      ].map(selector => ({
        selector: `JSXOpeningElement[name.name=/^h[1-6]$/] > JSXAttribute[name.name='className'] ${selector}`,
        message: 'A heading takes a title role, not its own size or weight: text-style-page-title, text-style-section-title, text-style-card-title (or PageHeader, CardTitle, DialogTitle). Remove text-* sizes and font-* weights.',
      })),
    ],
  },
}, {
  // A search picker is Combobox (ComboboxChips for several values), not a
  // Popover with a Command list inside: Combobox owns the popup width, the
  // empty state, the loading row, paging, the selected mark and the keyboard
  // behaviour. A copy of no-restricted-syntax under its own name, so it does
  // not replace the selectors above. Belongs in @vendure-io/design-lint once
  // it has a rule for it.
  files: ['src/**/*.tsx'],
  ignores: ['src/**/*.spec.tsx', 'src/**/*.stories.tsx', 'src/lib/components/ui/**'],
  plugins: {
    'search-picker': { rules: { 'no-restricted-syntax': builtinRules.get('no-restricted-syntax') } },
  },
  rules: {
    'search-picker/no-restricted-syntax': [
      'warn',
      {
        selector:
          "JSXElement[openingElement.name.name='PopoverContent'] JSXElement[openingElement.name.name='Command']",
        message: 'Use Combobox from @/vdb/components/ui/combobox.js for a search picker, not a Popover with a Command list.',
      },
    ],
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
