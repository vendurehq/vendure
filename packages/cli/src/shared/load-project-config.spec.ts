import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    ConfigResolverFailedError,
    configResolverPackages,
    loadProjectConfig,
    resolveProjectConfig,
} from './load-project-config.js';
import { loadVendureConfigFile } from './load-vendure-config-file.js';
import { ResolvedCommandManifest } from './resolve-cli-plugins.js';

vi.mock('./open-project.js', () => ({
    openProject: vi.fn(() => Promise.resolve({ project: {}, tsConfigPath: '/project/tsconfig.json' })),
}));
vi.mock('./vendure-config-ref.js', () => ({
    VendureConfigRef: vi.fn(function (this: Record<string, unknown>) {
        this.sourceFile = { getFilePath: () => '/project/src/vendure-config.ts' };
    }),
}));
vi.mock('./load-vendure-config-file.js', async importOriginal => ({
    ...(await importOriginal<typeof import('./load-vendure-config-file.js')>()),
    loadVendureConfigFile: vi.fn(() =>
        Promise.resolve({ dbConnectionOptions: { type: 'sqlite' }, from: 'source' }),
    ),
}));

/** A declarations module whose config resolver runs `body` as its `resolve(ctx)`. */
function declarations(body: string): string {
    return `
export const commands = [];
export const configResolver = {
    resolve: async () => ({
        resolve: async ctx => {
            globalThis.__resolverCalls.push(ctx);
            ${body}
        },
    }),
};
`;
}

describe('loadProjectConfig()', () => {
    let dir: string;
    let calls: Array<Record<string, unknown>>;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-project-config-'));
        calls = [];
        (globalThis as { __resolverCalls?: unknown[] }).__resolverCalls = calls;
    });

    afterEach(() => {
        delete (globalThis as { __resolverCalls?: unknown[] }).__resolverCalls;
        vi.clearAllMocks();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    /** An enabled package, with a config resolver whose `resolve(ctx)` runs `source` when it is given. */
    function plugin(name: string, source?: string): ResolvedCommandManifest {
        const definitionsPath = path.join(dir, `${name.replace(/\W/g, '-')}.mjs`);
        fs.writeFileSync(definitionsPath, source ? declarations(source) : 'export const commands = [];');
        return {
            packageName: name,
            definitionsPath,
            scope: 'project',
            manifest: {
                manifestVersion: 1,
                package: name,
                version: '1.0.0',
                commands: [],
                ...(source ? { hasConfigResolver: true as const } : {}),
            },
        };
    }

    it('returns the config of the first resolver, in allowlist order, that returns one', async () => {
        const plugins = [
            plugin('@acme/none'),
            plugin('@acme/other', 'return undefined;'),
            plugin('@acme/cloud', "return { dbConnectionOptions: { type: 'postgres' }, from: 'cloud' };"),
            plugin('@acme/later', "return { dbConnectionOptions: { type: 'mysql' }, from: 'later' };"),
        ];

        const result = await loadProjectConfig({ projectDir: dir, configFile: 'my-config.ts', plugins });

        expect(result).toEqual({
            config: { dbConnectionOptions: { type: 'postgres' }, from: 'cloud' },
            resolvedBy: '@acme/cloud',
            projectDir: dir,
        });
        expect(calls).toHaveLength(2);
        expect(calls[1]).toMatchObject({ projectDir: dir, configFile: path.resolve('my-config.ts') });
        expect(calls[1].signal).toBeInstanceOf(AbortSignal);
        expect(loadVendureConfigFile).not.toHaveBeenCalled();
    });

    it('gives the resolver --config as an absolute path, resolved from the working directory', async () => {
        await resolveProjectConfig({
            cwd: path.join(dir, 'src'),
            projectDir: dir,
            configFile: '../cloud.json',
            plugins: [plugin('@acme/other', 'return undefined;')],
        });

        expect(calls[0].configFile).toBe(path.join(dir, 'cloud.json'));
    });

    it('opens the project with the given opener to find a config in the source', async () => {
        const opener = vi.fn(() =>
            Promise.resolve({ project: {} as never, tsConfigPath: '/project/tsconfig.vendure.json' }),
        );

        const result = await loadProjectConfig({ projectDir: dir, plugins: [], openProject: opener });

        expect(opener).toHaveBeenCalledOnce();
        expect(loadVendureConfigFile).toHaveBeenCalledWith(result.ref, '/project/tsconfig.vendure.json');
    });

    it('passes the signal it was given to the resolver', async () => {
        const controller = new AbortController();
        await resolveProjectConfig({
            projectDir: dir,
            signal: controller.signal,
            plugins: [plugin('@acme/other', 'return undefined;')],
        });

        expect(calls[0].signal).toBe(controller.signal);
    });

    it('finds the config in the source when no resolver returns one', async () => {
        const result = await loadProjectConfig({
            projectDir: dir,
            plugins: [plugin('@acme/none'), plugin('@acme/other', 'return undefined;')],
        });

        expect(result.config).toEqual({ dbConnectionOptions: { type: 'sqlite' }, from: 'source' });
        expect(result.configPath).toBe('/project/src/vendure-config.ts');
        expect(result.resolvedBy).toBeUndefined();
        expect(loadVendureConfigFile).toHaveBeenCalledWith(result.ref, '/project/tsconfig.json');
    });

    it('throws config.resolver-failed, naming the package, when a resolver throws', async () => {
        const plugins = [plugin('@acme/cloud', "throw new Error('no Cloud config handle');")];

        const error = await loadProjectConfig({ projectDir: dir, plugins }).catch(e => e);

        expect(error).toBeInstanceOf(ConfigResolverFailedError);
        expect(error.details).toEqual({ plugin: '@acme/cloud', message: 'no Cloud config handle' });
        expect(error.message).toBe('The config resolver of @acme/cloud failed: no Cloud config handle');
        expect(loadVendureConfigFile).not.toHaveBeenCalled();
    });

    it('throws config.resolver-failed when a resolver returns something that is not a config', async () => {
        const plugins = [plugin('@acme/cloud', "return { name: 'not a config' };")];

        await expect(loadProjectConfig({ projectDir: dir, plugins })).rejects.toMatchObject({
            details: { plugin: '@acme/cloud', message: 'it returned something that is not a VendureConfig' },
        });
    });

    it('throws config.resolver-failed when the manifest lists a resolver the module does not export', async () => {
        const plugins = [plugin('@acme/cloud', 'return undefined;')];
        fs.writeFileSync(plugins[0].definitionsPath, 'export const commands = [];');

        await expect(loadProjectConfig({ projectDir: dir, plugins })).rejects.toMatchObject({
            details: {
                plugin: '@acme/cloud',
                message: expect.stringContaining('exports no "configResolver", which its manifest lists'),
            },
        });
    });

    it('lists only the packages whose manifests have a config resolver, without importing them', () => {
        const plugins = [plugin('@acme/none'), plugin('@acme/cloud', 'return undefined;')];
        fs.writeFileSync(plugins[1].definitionsPath, "throw new Error('imported');");

        expect(configResolverPackages({ plugins }).map(p => p.packageName)).toEqual(['@acme/cloud']);
    });
});
