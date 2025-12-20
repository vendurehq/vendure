import eslintConfigPrettier from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import jsdocPlugin from 'eslint-plugin-jsdoc';
import preferArrowPlugin from 'eslint-plugin-prefer-arrow';
import globals from 'globals';
import tseslint from 'typescript-eslint';
export default tseslint.config(
    // Ignores (equivalent to ignorePatterns)
    {
        ignores: [
            '**/node_modules/**',
            '**/dist/**',
            '**/generated*',
            '**/*.js',
            '**/*.d.ts',
            '/packages/ui-devkit/scaffold/**/*',
            '/packages/dev-server/load-testing/**/*',
            '/docs/layouts/**/*',
        ],
    },

    // Base config for all TS files
    {
        files: ['**/*.ts', '**/*.tsx'],
        extends: [...tseslint.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
        languageOptions: {
            parser: tseslint.parser,
            parserOptions: {
                project: true,
                sourceType: 'module',
            },
            globals: {
                ...globals.node,
                ...globals.es2021,
            },
        },
        plugins: {
            import: importPlugin,
            jsdoc: jsdocPlugin,
            'prefer-arrow': preferArrowPlugin,
        },
        rules: {
            '@typescript-eslint/adjacent-overload-signatures': 'error',
            '@typescript-eslint/array-type': [
                'error',
                {
                    default: 'array-simple',
                },
            ],
            '@typescript-eslint/await-thenable': 'error',
            '@typescript-eslint/ban-ts-comment': 'off',
            // ban-types was removed in v8, replaced with:
            '@typescript-eslint/no-wrapper-object-types': 'error', // Bans Number, String, Boolean, etc.
            '@typescript-eslint/no-unsafe-function-type': 'error', // Bans Function type
            '@typescript-eslint/consistent-type-assertions': 'error',
            '@typescript-eslint/consistent-type-definitions': 'off',
            '@typescript-eslint/dot-notation': 'error',
            '@typescript-eslint/explicit-function-return-type': 'off',
            '@typescript-eslint/explicit-member-accessibility': [
                'off',
                {
                    accessibility: 'explicit',
                },
            ],
            '@typescript-eslint/explicit-module-boundary-types': 'off',
            '@typescript-eslint/indent': 'off',
            '@typescript-eslint/member-ordering': 'off',
            '@typescript-eslint/naming-convention': [
                'off',
                {
                    selector: 'variable',
                    format: ['camelCase', 'UPPER_CASE'],
                    leadingUnderscore: 'forbid',
                    trailingUnderscore: 'forbid',
                },
            ],
            '@typescript-eslint/no-array-constructor': 'error',
            '@typescript-eslint/no-empty-function': 'error',
            '@typescript-eslint/no-empty-interface': 'off',
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-extra-non-null-assertion': 'error',
            '@typescript-eslint/no-extra-semi': 'error',
            '@typescript-eslint/no-floating-promises': 'error',
            '@typescript-eslint/no-for-in-array': 'error',
            '@typescript-eslint/no-implied-eval': 'error',
            '@typescript-eslint/no-inferrable-types': [
                'error',
                {
                    ignoreParameters: true,
                },
            ],
            '@typescript-eslint/no-loss-of-precision': 'error',
            '@typescript-eslint/no-misused-new': 'error',
            '@typescript-eslint/no-misused-promises': 'warn',
            '@typescript-eslint/no-namespace': 'error',
            '@typescript-eslint/no-non-null-asserted-optional-chain': 'error',
            '@typescript-eslint/no-non-null-assertion': 'error',
            '@typescript-eslint/no-parameter-properties': 'off',
            '@typescript-eslint/no-shadow': [
                'error',
                {
                    hoist: 'all',
                },
            ],
            '@typescript-eslint/no-this-alias': 'error',
            '@typescript-eslint/no-unnecessary-type-assertion': 'error',
            '@typescript-eslint/no-unnecessary-type-constraint': 'error',
            '@typescript-eslint/no-unsafe-argument': 'off',
            '@typescript-eslint/no-unsafe-assignment': 'off',
            '@typescript-eslint/no-unsafe-call': 'off',
            '@typescript-eslint/no-unsafe-member-access': 'off',
            '@typescript-eslint/no-unsafe-return': 'off',
            '@typescript-eslint/no-unused-expressions': 'error',
            '@typescript-eslint/no-unused-vars': 'off',
            '@typescript-eslint/no-use-before-define': 'off',
            '@typescript-eslint/no-var-requires': 'error',
            '@typescript-eslint/prefer-as-const': 'error',
            '@typescript-eslint/prefer-for-of': 'error',
            '@typescript-eslint/prefer-function-type': 'error',
            '@typescript-eslint/prefer-namespace-keyword': 'error',
            '@typescript-eslint/quotes': 'off',
            '@typescript-eslint/require-await': 'warn',
            '@typescript-eslint/restrict-plus-operands': 'error',
            '@typescript-eslint/restrict-template-expressions': 'error',
            '@typescript-eslint/triple-slash-reference': [
                'error',
                {
                    path: 'always',
                    types: 'prefer-import',
                    lib: 'always',
                },
            ],
            '@typescript-eslint/typedef': 'off',
            '@typescript-eslint/unbound-method': 'error',
            '@typescript-eslint/unified-signatures': 'error',
            'arrow-parens': ['off', 'always'],
            complexity: 'off',
            'constructor-super': 'error',
            'dot-notation': 'off',
            eqeqeq: ['error', 'smart'],
            'guard-for-in': 'error',
            'id-denylist': 'off',
            'id-match': 'off',
            'import/order': [
                'warn',
                {
                    alphabetize: {
                        caseInsensitive: true,
                        order: 'asc',
                    },
                    'newlines-between': 'always',
                    groups: [
                        ['builtin', 'external', 'internal', 'unknown', 'object', 'type'],
                        'parent',
                        ['sibling', 'index'],
                    ],
                    distinctGroup: false,
                    pathGroupsExcludedImportTypes: [],
                    pathGroups: [
                        {
                            pattern: './',
                            patternOptions: {
                                nocomment: true,
                                dot: true,
                            },
                            group: 'sibling',
                            position: 'before',
                        },
                        {
                            pattern: '.',
                            patternOptions: {
                                nocomment: true,
                                dot: true,
                            },
                            group: 'sibling',
                            position: 'before',
                        },
                        {
                            pattern: '..',
                            patternOptions: {
                                nocomment: true,
                                dot: true,
                            },
                            group: 'parent',
                            position: 'before',
                        },
                        {
                            pattern: '../',
                            patternOptions: {
                                nocomment: true,
                                dot: true,
                            },
                            group: 'parent',
                            position: 'before',
                        },
                    ],
                },
            ],
            indent: 'off',
            'jsdoc/check-alignment': 'off',
            'jsdoc/check-indentation': 'off',
            'jsdoc/newline-after-description': 'off',
            'max-classes-per-file': 'off',
            'max-len': [
                'error',
                {
                    code: 170,
                },
            ],
            'new-parens': 'error',
            'no-array-constructor': 'off',
            'no-bitwise': 'error',
            'no-caller': 'error',
            'no-cond-assign': 'error',
            'no-console': 'error',
            'no-debugger': 'error',
            'no-empty': 'error',
            'no-empty-function': 'off',
            'no-eval': 'error',
            'no-extra-semi': 'off',
            'no-fallthrough': 'error',
            'no-implied-eval': 'off',
            'no-invalid-this': 'off',
            'no-loss-of-precision': 'off',
            'no-new-wrappers': 'error',
            'no-shadow': 'off',
            'no-throw-literal': 'error',
            'no-trailing-spaces': 'error',
            'no-undef-init': 'error',
            'no-underscore-dangle': 'off',
            'no-unsafe-finally': 'error',
            'no-unused-expressions': 'off',
            'no-unused-labels': 'error',
            'no-unused-vars': 'off',
            'no-use-before-define': 'off',
            'no-var': 'error',
            'object-shorthand': 'error',
            'one-var': ['error', 'never'],
            'prefer-arrow/prefer-arrow-functions': 'off',
            'prefer-const': 'error',
            quotes: 'off',
            radix: 'error',
            'require-await': 'off',
            'spaced-comment': [
                'error',
                'always',
                {
                    markers: ['/'],
                },
            ],
            'use-isnan': 'error',
            'valid-typeof': 'off',
        },
    },

    // Override for ui-devkit client
    {
        files: ['packages/ui-devkit/src/client/**/*'],
        languageOptions: {
            parserOptions: {
                project: './packages/ui-devkit/tsconfig.json',
                sourceType: 'module',
            },
        },
    },

    // Override for ui-devkit compiler
    {
        files: ['packages/ui-devkit/src/compiler/**/*'],
        languageOptions: {
            parserOptions: {
                project: './packages/ui-devkit/tsconfig.compiler.json',
                sourceType: 'module',
            },
        },
    },

    // Prettier config (must be last)
    eslintConfigPrettier,
);
