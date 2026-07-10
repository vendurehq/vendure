import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

// Same bug class as https://github.com/vendurehq/vendure/issues/4920:
//
// Types from `@types/express` and `@types/fs-extra` are part of core's PUBLISHED `.d.ts`
// surface — e.g. `RequestContext.req` (express `Request`), `setSessionToken()` (express
// `Request`/`Response`), `createProxyHandler()` (express `RequestHandler`) and
// `AssetService.createFromFileStream()` (fs-extra `ReadStream`). Neither `express` nor
// `fs-extra` ship type definitions of their own, so the `@types/*` packages must be
// runtime `dependencies` to be delivered transitively to consumers. As devDependencies
// only, consumer projects fail to type-check against these public signatures (TS2353 etc.).
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

    it('exposes fs-extra types in its public API', () => {
        expect(read('service/services/asset.service.ts')).toContain(`from 'fs-extra'`);
    });

    it('declares @types/express as a runtime dependency, not a devDependency', () => {
        expect(pkg.dependencies?.['@types/express']).toBeTruthy();
        expect(pkg.devDependencies?.['@types/express']).toBeUndefined();
    });

    it('declares @types/fs-extra as a runtime dependency, not a devDependency', () => {
        expect(pkg.dependencies?.['@types/fs-extra']).toBeTruthy();
        expect(pkg.devDependencies?.['@types/fs-extra']).toBeUndefined();
    });
});
