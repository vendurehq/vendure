import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

// Same bug class as https://github.com/vendurehq/vendure/issues/4920:
//
// Types from `@types/express` are part of core's PUBLISHED `.d.ts` surface — e.g.
// `RequestContext.req` (express `Request`), `setSessionToken()` (express
// `Request`/`Response`) and `createProxyHandler()` (express `RequestHandler`).
// `express` ships no type definitions of its own, so `@types/express` must be a
// runtime `dependency` to be delivered transitively to consumers. As a devDependency
// only, consumer projects fail to type-check against these public signatures.
//
// This can only be guarded at the packaging level: inside this repo the `@types/*`
// packages are always resolvable regardless of dev/prod classification, so a type-level
// test passes in both states. The failure only manifests in an external consumer's install.
describe('core published type dependencies', () => {
    const packageRoot = path.join(__dirname, '..');
    const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf-8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
    };
    const read = (relPath: string) => fs.readFileSync(path.join(__dirname, relPath), 'utf-8');

    it('exposes express types in its public API', () => {
        // Guards the premise: if a future refactor removes these types from the public
        // surface, this fails and the runtime-dependency requirement should be revisited.
        expect(read('api/common/request-context.ts')).toContain(`from 'express'`);
        expect(read('plugin/plugin-utils.ts')).toContain(`from 'express'`);
    });

    it('does not expose fs-extra types in its public API', () => {
        // `AssetService.createFromFileStream()` takes fs's `ReadStream` (fs-extra's is the
        // same class re-exported). Importing it from 'fs-extra' would put `@types/fs-extra`
        // into the published `.d.ts` surface, forcing it to become a runtime dependency.
        expect(read('service/services/asset.service.ts')).not.toContain(`from 'fs-extra'`);
    });

    it('declares @types/express as a runtime dependency, not a devDependency', () => {
        expect(pkg.dependencies?.['@types/express']).toBeTruthy();
        expect(pkg.devDependencies?.['@types/express']).toBeUndefined();
    });
});
