/**
 * The repo compiles with TypeScript 7, whose `typescript` package only exposes the new
 * `typescript/sync` & `typescript/ast` APIs. Some dev tools still `require('typescript')` and
 * expect the TypeScript 5/6 JS API:
 *
 * - typescript-eslint (and tsutils / ts-api-utils), which supports `typescript <6.1`
 * - prettier-plugin-organize-imports
 *
 * Bun only supports top-level `overrides`, so we can't give just these packages a nested
 * TypeScript 6. Instead, this redirects `require('typescript')` to the TypeScript 6 copy installed
 * by the private ./typescript6 workspace package, but only when it is required from one of the
 * packages above. Everything else keeps resolving TypeScript 7.
 *
 * Loaded from `.eslintrc.js` and `scripts/tooling/prettier-plugin-organize-imports.cjs`.
 * Remove once these tools support TypeScript 7.
 */
const Module = require('node:module');
const path = require('node:path');

const PATCHED = Symbol.for('vendure.useTypeScript6ForTools');
const TOOL_PACKAGES = [
    '@typescript-eslint',
    'tsutils',
    'ts-api-utils',
    'prettier-plugin-organize-imports',
].map(name => `${path.sep}node_modules${path.sep}${name.split('/').join(path.sep)}${path.sep}`);

if (!globalThis[PATCHED]) {
    globalThis[PATCHED] = true;
    const typescript6Path = require.resolve('typescript', { paths: [path.join(__dirname, 'typescript6')] });
    const originalResolveFilename = Module._resolveFilename;
    Module._resolveFilename = function (request, parent, ...rest) {
        if (
            request === 'typescript' &&
            parent?.filename &&
            TOOL_PACKAGES.some(dir => parent.filename.includes(dir))
        ) {
            return typescript6Path;
        }
        return originalResolveFilename.call(this, request, parent, ...rest);
    };
}
