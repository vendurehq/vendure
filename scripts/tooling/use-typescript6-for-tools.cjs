/**
 * The repo compiles with TypeScript 7, whose `typescript` package only exposes the new
 * `typescript/sync` & `typescript/ast` APIs. Some dev tools still load `typescript` and
 * expect the TypeScript 5/6 JS API:
 *
 * - typescript-eslint (and tsutils / ts-api-utils), which supports `typescript <6.1`
 * - prettier-plugin-organize-imports
 * - Storybook's `react-docgen-typescript` prop table generation (@storybook/react,
 *   react-docgen-typescript and @joshwooding/vite-plugin-react-docgen-typescript)
 *
 * Bun only supports top-level `overrides`, so we can't give just these packages a nested
 * TypeScript 6. Instead, this redirects `typescript` to the TypeScript 6 copy installed by the
 * private ./typescript6 workspace package, but only when it is required or imported from one of
 * the packages above. Everything else keeps resolving TypeScript 7.
 *
 * Both `require('typescript')` and `import ts from 'typescript'` are redirected: through
 * `module.registerHooks()` where Node.js supports it (22.15+), and otherwise by patching the
 * CommonJS resolver, which only covers `require()`.
 *
 * Loaded from `.eslintrc.js`, packages/dashboard/eslint.config.js, packages/dashboard/.storybook/main.ts
 * and `scripts/tooling/prettier-plugin-organize-imports.cjs`.
 * Remove once these tools support TypeScript 7.
 */
const Module = require('node:module');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const PATCHED = Symbol.for('vendure.useTypeScript6ForTools');
const TOOL_PACKAGE_NAMES = [
    '@typescript-eslint',
    'tsutils',
    'ts-api-utils',
    'prettier-plugin-organize-imports',
    '@storybook/react',
    'react-docgen-typescript',
    '@joshwooding/vite-plugin-react-docgen-typescript',
];
/** Matches file paths (CommonJS `parent.filename`), with the platform's separator. */
const TOOL_PACKAGE_PATHS = TOOL_PACKAGE_NAMES.map(
    name => `${path.sep}node_modules${path.sep}${name.split('/').join(path.sep)}${path.sep}`,
);
/** Matches file URLs (`context.parentURL` of the module hooks), which always use `/`. */
const TOOL_PACKAGE_URL_PARTS = TOOL_PACKAGE_NAMES.map(name => `/node_modules/${name}/`);

if (!globalThis[PATCHED]) {
    globalThis[PATCHED] = true;
    const typescript6Path = require.resolve('typescript', { paths: [path.join(__dirname, 'typescript6')] });

    if (typeof Module.registerHooks === 'function') {
        const typescript6Url = pathToFileURL(typescript6Path).href;
        Module.registerHooks({
            resolve(specifier, context, nextResolve) {
                if (
                    specifier === 'typescript' &&
                    context.parentURL &&
                    TOOL_PACKAGE_URL_PARTS.some(part => context.parentURL.includes(part))
                ) {
                    return { url: typescript6Url, format: 'commonjs', shortCircuit: true };
                }
                return nextResolve(specifier, context);
            },
        });
    }

    // Also patch the CommonJS resolver: for Node.js versions without `registerHooks`, and for
    // code that calls Module._resolveFilename directly.
    const originalResolveFilename = Module._resolveFilename;
    Module._resolveFilename = function (request, parent, ...rest) {
        if (
            request === 'typescript' &&
            parent?.filename &&
            TOOL_PACKAGE_PATHS.some(dir => parent.filename.includes(dir))
        ) {
            return typescript6Path;
        }
        return originalResolveFilename.call(this, request, parent, ...rest);
    };
}
