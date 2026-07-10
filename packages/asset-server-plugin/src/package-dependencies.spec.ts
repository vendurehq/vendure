import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

// Same bug class as https://github.com/vendurehq/vendure/issues/4920:
//
// Express types are part of this plugin's PUBLISHED `.d.ts` surface — e.g.
// `GetImageTransformParametersArgs.req` (express `Request`), the storage-strategy
// `toAbsoluteUrl` callbacks, and `AssetServer.createAssetServer()` (express `Router`).
// `express` ships no type definitions of its own, so `@types/express` must be a runtime
// `dependency` to be delivered transitively to consumers; as a devDependency only,
// consumer projects fail to type-check against these public signatures.
//
// `express` itself is also imported at runtime (`asset-server.ts`), so it must be a
// runtime dependency too rather than relying on the consumer's hoisted copy from core.
//
// This can only be guarded at the packaging level: inside this repo `@types/express` is
// always resolvable regardless of dev/prod classification, so a type-level test passes
// in both states. The failure only manifests in an external consumer's install.
describe('asset-server-plugin published type dependencies', () => {
    const packageRoot = path.join(__dirname, '..');
    const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf-8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
    };
    const read = (relPath: string) => fs.readFileSync(path.join(__dirname, relPath), 'utf-8');

    it('exposes express types in its public API', () => {
        // Guards the premise: if a future refactor removes these types from the public
        // surface, this fails and the runtime-dependency requirement should be revisited.
        expect(read('config/image-transform-strategy.ts')).toContain(`from 'express'`);
        expect(read('asset-server.ts')).toContain(`from 'express'`);
    });

    it('declares express as a runtime dependency, not a devDependency', () => {
        expect(pkg.dependencies?.express).toBeTruthy();
        expect(pkg.devDependencies?.express).toBeUndefined();
    });

    it('declares @types/express as a runtime dependency, not a devDependency', () => {
        expect(pkg.dependencies?.['@types/express']).toBeTruthy();
        expect(pkg.devDependencies?.['@types/express']).toBeUndefined();
    });
});
