/**
 * Module boundary rules between the packages of this repository.
 *
 * `.eslintrc.js` includes these rules. CI also runs them alone with `bun run lint:boundaries`,
 * without type information, so that the check is fast and other lint errors do not block it.
 * `@nx/enforce-module-boundaries` reads the cached Nx project graph and skips itself when there
 * is none, so that script runs an Nx command first.
 *
 * The rules use the `nx.tags` of each project:
 * - `scope:core`      core and common. Can only import each other.
 * - `scope:plugin`    Vendure plugin packages.
 * - `scope:util`      libraries for plugins and tests, for example testing and mcp-sdk.
 * - `scope:dashboard` the dashboard.
 * - `scope:tool`      the CLI, create and repository tooling.
 * - `scope:app`       the dev server.
 *
 * A project without a matching tag cannot import any project, so a project with no tags fails.
 *
 * The boundary rule applies to the published source of each package. Tests and e2e specs are not
 * checked yet: they import `@vendure/core` from inside core, and files of other packages by
 * relative path. The rule against `dist` imports applies to all files of the plugin packages,
 * tests included.
 */
const depConstraints = [
    { sourceTag: 'scope:core', onlyDependOnLibsWithTags: ['scope:core'] },
    {
        sourceTag: 'scope:plugin',
        onlyDependOnLibsWithTags: ['scope:core', 'scope:util', 'scope:dashboard', 'scope:plugin'],
    },
    { sourceTag: 'scope:util', onlyDependOnLibsWithTags: ['scope:core', 'scope:util'] },
    {
        sourceTag: 'scope:dashboard',
        onlyDependOnLibsWithTags: ['scope:core', 'scope:util', 'scope:dashboard'],
    },
    {
        sourceTag: 'scope:tool',
        onlyDependOnLibsWithTags: ['scope:core', 'scope:util', 'scope:dashboard', 'scope:tool'],
    },
    { sourceTag: 'scope:app', onlyDependOnLibsWithTags: ['*'] },
];

const sourceFiles = ['packages/*/index.ts', 'packages/*/src/**/*.ts', 'packages/*/src/**/*.tsx'];
const testFiles = ['**/*.spec.ts', '**/*.spec.tsx', '**/*.spec-d.ts'];

/**
 * Files that must import other packages through their public entry points, not from `dist`.
 * Today these are the plugin packages. To extend the rule to more packages, add their globs here.
 */
const publicEntryPointOnlyFiles = ['packages/*-plugin/**/*.ts', 'packages/*-plugin/**/*.tsx'];

/** Existing deep imports into `@vendure/core/dist`. Remove an entry when its import is fixed. */
const distImportExceptions = [
    'packages/email-plugin/src/plugin.spec.ts',
    'packages/telemetry-plugin/src/instrumentation.ts',
];

const moduleBoundaries = (allow = []) => ['error', { allow, depConstraints }];

const overrides = [
    {
        files: sourceFiles,
        excludedFiles: testFiles,
        rules: {
            '@nx/enforce-module-boundaries': moduleBoundaries(),
        },
    },
    {
        // The populate CLI imports the `@vendure/core` that the project installs, on purpose.
        files: ['packages/core/src/cli/populate.ts'],
        rules: {
            '@nx/enforce-module-boundaries': moduleBoundaries(['^@vendure/core$']),
        },
    },
    {
        files: publicEntryPointOnlyFiles,
        excludedFiles: distImportExceptions,
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['@vendure/*/dist/**'],
                            message:
                                'Import from the public entry point of the package, not from its dist folder.',
                        },
                    ],
                },
            ],
        },
    },
];

module.exports = {
    root: true,
    parser: '@typescript-eslint/parser',
    parserOptions: {
        sourceType: 'module',
    },
    plugins: ['@nx'],
    // This config does not load the other rules, so `eslint-disable` comments for them must not
    // fail. ESLint warns about each ignored comment; run it with `--quiet`.
    noInlineConfig: true,
    ignorePatterns: ['**/generated*', '**/*.js', '**/*.d.ts', '**/node_modules/**'],
    overrides,
};
