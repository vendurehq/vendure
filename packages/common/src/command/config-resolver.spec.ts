import { describe, expect, it } from 'vitest';

import { ConfigResolverDefinition, configResolverDeclaration, defineConfigResolver } from './config-resolver';
import { buildCommandManifest } from './manifest/build';

const resolver = defineConfigResolver({
    resolve: () => Promise.resolve({ resolve: () => Promise.resolve(undefined) }),
});

describe('configResolverDeclaration()', () => {
    it('reads the configResolver export, or the one on the default export', () => {
        expect(configResolverDeclaration({ configResolver: resolver })).toBe(resolver);
        expect(configResolverDeclaration({ default: { configResolver: resolver } })).toBe(resolver);
    });

    it('returns undefined for a module that exports no config resolver', () => {
        expect(configResolverDeclaration({ commands: [] })).toBeUndefined();
        expect(configResolverDeclaration(undefined)).toBeUndefined();
    });

    it('throws for a configResolver export that has no resolve() function', () => {
        expect(() => configResolverDeclaration({ configResolver: {} })).toThrow(
            'The module exports "configResolver" that has no resolve() function',
        );
    });
});

describe('buildCommandManifest() with a config resolver', () => {
    it('records hasConfigResolver only for a package that has one', async () => {
        const withResolver = await buildCommandManifest('@acme/cloud', '1.0.0', [], {
            configResolver: resolver,
        });
        const without = await buildCommandManifest('@acme/cloud', '1.0.0', []);

        expect(withResolver.hasConfigResolver).toBe(true);
        expect('hasConfigResolver' in without).toBe(false);
    });

    it('rejects a config resolver that has no resolve() function', async () => {
        await expect(
            buildCommandManifest('@acme/cloud', '1.0.0', [], {
                configResolver: {} as unknown as ConfigResolverDefinition,
            }),
        ).rejects.toThrow('The module exports "configResolver" that has no resolve() function');
    });
});
