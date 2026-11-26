import { VendurePlugin } from '@vendure/core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadVendureConfigFile } from '../../../shared/load-vendure-config-file.js';
import { resolveCommandManifests } from '../../../shared/resolve-cli-plugins.js';

import { isCompatibleWithCore, runConfigCheck } from './config-check.js';

vi.mock('../../../shared/shared-prompts.js', () => ({
    openAnalyzedProject: vi.fn(() => () => Promise.resolve({ project: {}, tsConfigPath: undefined })),
}));

vi.mock('../../../shared/vendure-config-ref.js', () => ({
    // A `function` (not an arrow function) because the code under test calls it with `new`.
    VendureConfigRef: vi.fn(function () {
        return {
            getPathRelativeToProjectRoot: () => 'vendure-config.ts',
            sourceFile: { getFilePath: () => '/project/vendure-config.ts' },
        };
    }),
}));

vi.mock('../../../shared/load-vendure-config-file.js', async importOriginal => ({
    ...(await importOriginal<typeof import('../../../shared/load-vendure-config-file.js')>()),
    loadVendureConfigFile: vi.fn(),
}));

// No enabled package has a config resolver, unless a test says otherwise.
vi.mock('../../../shared/resolve-cli-plugins.js', async importOriginal => ({
    ...(await importOriginal<typeof import('../../../shared/resolve-cli-plugins.js')>()),
    resolveCommandManifests: vi.fn(() => ({ manifests: [], failures: [], scopeErrors: [] })),
}));

// Use the workspace package as the "project" copy, so that the plugins below and the
// config check share one `@vendure/core`.
vi.mock('../../../shared/project-core.js', () => ({
    requireProjectCore: () => require('@vendure/core'),
}));

@VendurePlugin({ compatibility: '^1.0.0' })
class IncompatibleChildPlugin {}

@VendurePlugin({ plugins: [IncompatibleChildPlugin], compatibility: '>0.0.0' })
class ParentPlugin {}

describe('runConfigCheck()', () => {
    // #5430 — a composed plugin is loaded, so its compatibility range is checked too.
    it('checks the compatibility of composed plugins', async () => {
        vi.mocked(loadVendureConfigFile).mockResolvedValue({
            apiOptions: {},
            authOptions: {},
            dbConnectionOptions: { type: 'better-sqlite3' },
            plugins: [{ module: ParentPlugin }],
        } as any);

        const { check } = await runConfigCheck();

        expect(check.status).toBe('fail');
        expect(check.details).toContain('2 plugin(s) loaded');
        expect(check.details?.join('\n')).toContain('Plugin "IncompatibleChildPlugin": incompatible');
    });
});

describe('runConfigCheck() with a config resolver', () => {
    let dir: string | undefined;

    afterEach(() => {
        vi.clearAllMocks();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
            dir = undefined;
        }
    });

    /** Enables `@acme/cloud`, whose config resolver's `resolve(ctx)` runs `body`. */
    function enableResolver(body: string) {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-doctor-resolver-'));
        const definitionsPath = path.join(dir, 'cloud.mjs');
        fs.writeFileSync(
            definitionsPath,
            `export const commands = [];
export const configResolver = { resolve: async () => ({ resolve: async ctx => { ${body} } }) };`,
        );
        vi.mocked(resolveCommandManifests).mockReturnValueOnce({
            manifests: [
                {
                    packageName: '@acme/cloud',
                    definitionsPath,
                    scope: 'project',
                    manifest: {
                        manifestVersion: 1,
                        package: '@acme/cloud',
                        version: '1.0.0',
                        commands: [],
                        hasConfigResolver: true,
                    },
                },
            ],
            failures: [],
            scopeErrors: [],
        });
    }

    it('says which package resolved the config', async () => {
        enableResolver(
            "return { apiOptions: {}, authOptions: {}, dbConnectionOptions: { type: 'better-sqlite3' }, plugins: [] };",
        );

        const { check } = await runConfigCheck();

        expect(check.details).toContain('Config loaded from the config resolver of @acme/cloud');
        expect(check.status).toBe('pass');
    });

    it('fails with the config.resolver-failed code when the resolver throws', async () => {
        enableResolver("throw new Error('no Cloud config handle');");

        const { check } = await runConfigCheck();

        expect(check.status).toBe('fail');
        expect(check.details).toContain(
            'Error (config.resolver-failed): The config resolver of @acme/cloud failed: no Cloud config handle',
        );
    });

    it('rethrows when doctor was cancelled, so the host reports it as cancelled, not as a failed check', async () => {
        enableResolver('ctx.signal.throwIfAborted();');
        const controller = new AbortController();
        controller.abort();

        await expect(runConfigCheck(undefined, controller.signal)).rejects.toMatchObject({
            name: 'AbortError',
        });
    });
});

describe('isCompatibleWithCore()', () => {
    type Core = Parameters<typeof isCompatibleWithCore>[0];

    it("delegates to the project core's isCompatible", () => {
        const isCompatible = vi.fn(() => true);
        const core = { VENDURE_VERSION: '4.0.0-major-202611260711', isCompatible } as unknown as Core;

        expect(isCompatibleWithCore(core, '^4.0.0')).toBe(true);
        expect(isCompatible).toHaveBeenCalledWith('4.0.0-major-202611260711', '^4.0.0');
    });

    it('checks the range itself for a core that has no isCompatible', () => {
        const core = { VENDURE_VERSION: '3.5.0' } as unknown as Core;

        expect(isCompatibleWithCore(core, '^3.0.0')).toBe(true);
        expect(isCompatibleWithCore(core, '^4.0.0')).toBe(false);
    });
});
