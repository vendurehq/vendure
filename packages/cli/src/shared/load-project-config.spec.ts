import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configResolverPackage } from './__tests__/config-resolver-package.js';
import {
    ConfigResolverFailedError,
    configResolverOwners,
    configResolverPackages,
    loadProjectConfig,
    resolveProjectConfig,
    SourceProjectConfig,
} from './load-project-config.js';
import {
    loadVendureConfigFile,
    prepareToRequireProjectFiles,
    requireProjectModule,
} from './load-vendure-config-file.js';
import { resolveCommandManifests, ResolvedCommandManifest } from './resolve-cli-plugins.js';

vi.mock('./resolve-cli-plugins.js', async importOriginal => ({
    ...(await importOriginal<typeof import('./resolve-cli-plugins.js')>()),
    resolveCommandManifests: vi.fn(() => ({ manifests: [], failures: [], scopeErrors: [] })),
}));
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
    prepareToRequireProjectFiles: vi.fn(() => Promise.resolve()),
    loadVendureConfigFile: vi.fn(() =>
        Promise.resolve({ dbConnectionOptions: { type: 'sqlite' }, from: 'source' }),
    ),
    requireProjectModule: vi.fn(() =>
        Promise.resolve({ default: { handle: 'cloud' }, config: { not: 'used' } }),
    ),
}));

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
    function plugin(
        name: string,
        source?: string,
        scope: 'project' | 'global' = 'project',
    ): ResolvedCommandManifest {
        const body = source === undefined ? undefined : `globalThis.__resolverCalls.push(ctx);\n${source}`;
        return configResolverPackage(dir, name, body, scope);
    }

    it('returns the config of the first resolver, in allowlist order, that returns one', async () => {
        const plugins = [
            plugin('@acme/none'),
            plugin('@acme/other', 'return undefined;'),
            plugin('@acme/cloud', "return { dbConnectionOptions: { type: 'postgres' }, from: 'cloud' };"),
            plugin('@acme/later', "return { dbConnectionOptions: { type: 'mysql' }, from: 'later' };"),
        ];

        const result = await loadProjectConfig({
            cwd: dir,
            projectDir: dir,
            configFile: 'my-config.ts',
            plugins,
        });

        expect(result).toEqual({
            config: { dbConnectionOptions: { type: 'postgres' }, from: 'cloud' },
            resolvedBy: '@acme/cloud',
            projectDir: dir,
        });
        expect(calls).toHaveLength(2);
        expect(calls[1]).toMatchObject({ projectDir: dir, configFile: path.join(dir, 'my-config.ts') });
        expect(calls[1].signal).toBeInstanceOf(AbortSignal);
        expect(loadVendureConfigFile).not.toHaveBeenCalled();
        expect(requireProjectModule).not.toHaveBeenCalled();
    });

    it("asks the project's resolvers before the ones enabled for the whole machine", async () => {
        const plugins = [
            plugin(
                '@acme/global',
                "return { dbConnectionOptions: { type: 'mysql' }, from: 'global' };",
                'global',
            ),
            plugin('@acme/project', "return { dbConnectionOptions: { type: 'postgres' }, from: 'project' };"),
        ];

        const result = await resolveProjectConfig({ projectDir: dir, plugins });

        expect(result?.resolvedBy).toBe('@acme/project');
        // The files the resolved config names may be TypeScript.
        expect(prepareToRequireProjectFiles).toHaveBeenCalledWith(dir);
        expect(configResolverPackages(plugins).map(p => p.packageName)).toEqual([
            '@acme/project',
            '@acme/global',
        ]);
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
        expect('ref' in result).toBe(true);
        expect(loadVendureConfigFile).toHaveBeenCalledWith(
            (result as SourceProjectConfig).ref,
            '/project/tsconfig.vendure.json',
        );
    });

    it('imports a module for the resolver, relative to the project, only when it asks', async () => {
        const result = await resolveProjectConfig({
            projectDir: dir,
            plugins: [
                plugin('@acme/other', 'return undefined;'),
                plugin(
                    '@acme/cloud',
                    "const mod = await ctx.loadModule('src/vendure-config.ts');\n" +
                        "return { dbConnectionOptions: { type: 'postgres' }, handle: mod.default.handle };",
                ),
            ],
        });

        expect(requireProjectModule).toHaveBeenCalledOnce();
        expect(requireProjectModule).toHaveBeenCalledWith(path.join(dir, 'src', 'vendure-config.ts'));
        expect(result?.config).toEqual({ dbConnectionOptions: { type: 'postgres' }, handle: 'cloud' });
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
        expect(result).toMatchObject({ configPath: '/project/src/vendure-config.ts' });
        expect('resolvedBy' in result).toBe(false);
        expect(loadVendureConfigFile).toHaveBeenCalledWith(
            (result as SourceProjectConfig).ref,
            '/project/tsconfig.json',
        );
    });

    it('throws config.resolver-failed, naming the package, when a resolver throws', async () => {
        const plugins = [plugin('@acme/cloud', "throw new Error('no Cloud config handle');")];

        const error = await loadProjectConfig({ projectDir: dir, plugins }).catch(e => e);

        expect(error).toBeInstanceOf(ConfigResolverFailedError);
        expect(error.details).toEqual({ plugin: '@acme/cloud', message: 'no Cloud config handle' });
        expect(error.message).toBe('The config resolver of @acme/cloud failed: no Cloud config handle');
        expect(loadVendureConfigFile).not.toHaveBeenCalled();
    });

    it('names the package when the project cannot be prepared for the config the resolver returned', async () => {
        vi.mocked(prepareToRequireProjectFiles).mockRejectedValueOnce(
            new Error('tsconfig.json is not valid JSON'),
        );
        const plugins = [plugin('@acme/cloud', "return { dbConnectionOptions: { type: 'postgres' } };")];

        const error = await loadProjectConfig({ projectDir: dir, plugins }).catch(e => e);

        expect(error.message).toBe(
            'The config resolver of @acme/cloud returned a config, but the project could not be prepared to ' +
                'load the TypeScript files it names: tsconfig.json is not valid JSON',
        );
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

    it('rethrows the error of a resolver that stops because the command was cancelled', async () => {
        const controller = new AbortController();
        controller.abort();
        const plugins = [plugin('@acme/cloud', 'ctx.signal.throwIfAborted();')];

        const error = await loadProjectConfig({ projectDir: dir, signal: controller.signal, plugins }).catch(
            e => e,
        );

        expect(error).not.toBeInstanceOf(ConfigResolverFailedError);
        expect(error.name).toBe('AbortError');
    });

    it('names the enabled packages whose manifest could not be read when the source has no config', async () => {
        const withFailure = {
            manifests: [],
            failures: [
                {
                    packageName: '@acme/cloud',
                    reason: 'vendure-commands.json is missing',
                    scope: 'project',
                    notInstalled: false,
                    declaresCommandManifest: true,
                },
            ],
            scopeErrors: [],
        } as unknown as ReturnType<typeof resolveCommandManifests>;
        vi.mocked(resolveCommandManifests).mockReturnValueOnce(withFailure);
        vi.mocked(loadVendureConfigFile).mockRejectedValueOnce(new Error('No VendureConfig found.'));

        await expect(loadProjectConfig({ projectDir: dir })).rejects.toThrow(
            'No VendureConfig found. The manifest of these enabled packages could not be read, so any ' +
                'config resolver they have was not asked: @acme/cloud (vendure-commands.json is missing)',
        );
        expect(resolveCommandManifests).toHaveBeenCalledOnce();
    });

    it('lists only the packages whose manifests have a config resolver, without importing them', () => {
        const plugins = [plugin('@acme/none'), plugin('@acme/cloud', 'return undefined;')];
        fs.writeFileSync(plugins[1].definitionsPath, "throw new Error('imported');");

        expect(configResolverPackages(plugins).map(p => p.packageName)).toEqual(['@acme/cloud']);
    });

    describe("the project's own config resolver", () => {
        /** Declares `vendure.configResolver` in the project's package.json, and writes the module. */
        function declareProjectResolver(
            resolve?: (ctx: unknown) => Promise<unknown>,
            value: unknown = './resolver.ts',
        ) {
            fs.writeFileSync(
                path.join(dir, 'package.json'),
                JSON.stringify({ name: 'example-app', vendure: { configResolver: value } }),
            );
            fs.writeFileSync(path.join(dir, 'resolver.ts'), '');
            if (resolve) {
                vi.mocked(requireProjectModule).mockResolvedValueOnce({ resolve });
            }
        }

        it('is asked before the resolvers of the enabled packages', async () => {
            declareProjectResolver(() =>
                Promise.resolve({ dbConnectionOptions: { type: 'postgres' }, from: 'project' }),
            );
            const plugins = [
                plugin('@acme/cloud', "return { dbConnectionOptions: { type: 'mysql' }, from: 'cloud' };"),
            ];

            const result = await loadProjectConfig({ cwd: dir, projectDir: dir, plugins });

            expect(result).toMatchObject({
                resolvedBy: 'the project example-app',
                config: { from: 'project' },
            });
            expect(requireProjectModule).toHaveBeenCalledWith(path.join(dir, 'resolver.ts'));
            expect(calls).toHaveLength(0);
        });

        it('gives it the same context as a package resolver', async () => {
            const resolve = vi.fn(() => Promise.resolve(undefined));
            declareProjectResolver(resolve);

            await resolveProjectConfig({ cwd: dir, projectDir: dir, configFile: 'a.ts', plugins: [] });

            expect(resolve).toHaveBeenCalledWith(
                expect.objectContaining({ projectDir: dir, configFile: path.join(dir, 'a.ts') }),
            );
        });

        it('falls through to the package resolvers, then the source, when it returns undefined', async () => {
            declareProjectResolver(() => Promise.resolve(undefined));
            const plugins = [plugin('@acme/other', 'return undefined;')];

            const result = await loadProjectConfig({ cwd: dir, projectDir: dir, plugins });

            expect(calls).toHaveLength(1);
            expect((result as SourceProjectConfig).config).toMatchObject({ from: 'source' });
        });

        it('throws config.resolver-failed, naming the project, when it throws', async () => {
            declareProjectResolver(() => Promise.reject(new Error('no secrets')));

            const error = await loadProjectConfig({ cwd: dir, projectDir: dir, plugins: [] }).catch(e => e);

            expect(error).toBeInstanceOf(ConfigResolverFailedError);
            expect(error.details).toEqual({ plugin: 'the project example-app', message: 'no secrets' });
        });

        it('throws config.resolver-failed when its module exports no resolve()', async () => {
            declareProjectResolver();
            vi.mocked(requireProjectModule).mockResolvedValueOnce({ other: 1 });

            const error = await loadProjectConfig({ cwd: dir, projectDir: dir, plugins: [] }).catch(e => e);

            expect(error.details).toEqual({
                plugin: 'the project example-app',
                message: 'its module exports no resolve() function',
            });
        });

        it('throws config.resolver-failed when the module it names does not exist', async () => {
            declareProjectResolver(undefined, './missing.ts');

            const error = await loadProjectConfig({ cwd: dir, projectDir: dir, plugins: [] }).catch(e => e);

            expect(error).toBeInstanceOf(ConfigResolverFailedError);
            expect(error.details.message).toContain('missing.ts');
            expect(requireProjectModule).not.toHaveBeenCalled();
        });

        it('throws config.resolver-failed when vendure.configResolver is not a path', async () => {
            declareProjectResolver(undefined, 42);

            const error = await loadProjectConfig({ cwd: dir, projectDir: dir, plugins: [] }).catch(e => e);

            expect(error).toBeInstanceOf(ConfigResolverFailedError);
            expect(error.details.plugin).toBe('the project example-app');
        });

        it('is listed first among the owners of config resolvers, without running it', () => {
            declareProjectResolver();
            const plugins = [plugin('@acme/cloud', 'return undefined;')];

            expect(configResolverOwners(plugins, { cwd: dir, projectDir: dir })).toEqual([
                'the project example-app',
                '@acme/cloud',
            ]);
            expect(requireProjectModule).not.toHaveBeenCalled();
        });
    });
});
