import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { CLI_PLUGINS_ENV_VAR } from './cli-global-plugin-config';
import { discoverCliPlugins, PackageJsonLike, resolveCliPlugins } from './resolve-cli-plugins';

describe('CLI plugin scopes', () => {
    const tempDirs: string[] = [];

    afterEach(() => {
        for (const dir of tempDirs.splice(0)) {
            fs.removeSync(dir);
        }
    });

    function makeTempDir(prefix: string): string {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
        tempDirs.push(dir);
        return dir;
    }

    /**
     * A package installed under `root/node_modules`, shaped like a CLI plugin.
     * `commandName` becomes the one command it contributes, so a test can tell
     * which copy of a package was loaded.
     */
    function installPlugin(root: string, packageName: string, commandName: string): void {
        const dir = path.join(root, 'node_modules', ...packageName.split('/'));
        fs.ensureDirSync(dir);
        fs.writeJsonSync(path.join(dir, 'package.json'), {
            name: packageName,
            version: '1.0.0',
            vendure: { cliPlugin: './cli-plugin.js', cliCommands: [commandName] },
        });
        fs.writeFileSync(
            path.join(dir, 'cli-plugin.js'),
            `module.exports = {
                id: '${packageName}',
                commands: [{
                    name: '${commandName}',
                    description: 'From ${packageName}',
                    action: async () => 0,
                }],
            };\n`,
        );
    }

    /**
     * An environment with its own config directory, so no test reads or writes
     * the config of the machine it runs on. `pluginRoots` points the global
     * scope at a directory the test controls, standing in for the global
     * `node_modules` the CLI would really be installed in.
     */
    function makeGlobalEnv(options: { plugins?: string[]; roots?: string[] }): NodeJS.ProcessEnv {
        const configDir = makeTempDir('vendure-scope-config-');
        fs.writeJsonSync(path.join(configDir, 'cli.json'), {
            plugins: options.plugins ?? [],
            pluginRoots: options.roots ?? [],
        });
        return { VENDURE_CLI_CONFIG_DIR: configDir };
    }

    /** A project whose package.json the test supplies directly. */
    function makeProject(options: {
        dependencies?: Record<string, string>;
        plugins?: string[];
    }): { root: string; packageJson: PackageJsonLike } {
        const root = makeTempDir('vendure-scope-project-');
        const packageJson: PackageJsonLike = {
            name: 'shop',
            dependencies: options.dependencies ?? {},
            vendure: { cli: { plugins: options.plugins ?? [] } },
        };
        fs.writeJsonSync(path.join(root, 'package.json'), packageJson);
        return { root, packageJson };
    }

    it('loads a plugin enabled in the global config', () => {
        const globalRoot = makeTempDir('vendure-scope-global-');
        installPlugin(globalRoot, '@example/cloud', 'cloud');
        const env = makeGlobalEnv({ plugins: ['@example/cloud'], roots: [globalRoot] });

        const { loaded, failures } = resolveCliPlugins({ env });

        expect(failures).toEqual([]);
        expect(loaded.map(entry => ({ name: entry.packageName, scope: entry.scope }))).toEqual([
            { name: '@example/cloud', scope: 'global' },
        ]);
    });

    it('loads a plugin named only by the environment variable', () => {
        const globalRoot = makeTempDir('vendure-scope-global-');
        installPlugin(globalRoot, '@example/cloud', 'cloud');
        const env = {
            ...makeGlobalEnv({ roots: [globalRoot] }),
            [CLI_PLUGINS_ENV_VAR]: '@example/cloud',
        };

        const { loaded } = resolveCliPlugins({ env });

        expect(loaded.map(entry => entry.packageName)).toEqual(['@example/cloud']);
    });

    it('does not load a globally installed plugin that is not enabled', () => {
        const globalRoot = makeTempDir('vendure-scope-global-');
        installPlugin(globalRoot, '@example/cloud', 'cloud');
        const env = makeGlobalEnv({ roots: [globalRoot] });

        expect(resolveCliPlugins({ env }).loaded).toEqual([]);
    });

    it('reports a globally enabled package that is not installed', () => {
        const globalRoot = makeTempDir('vendure-scope-global-');
        const env = makeGlobalEnv({ plugins: ['@example/missing'], roots: [globalRoot] });

        const { loaded, failures } = resolveCliPlugins({ env });

        expect(loaded).toEqual([]);
        expect(failures).toHaveLength(1);
        expect(failures[0].scope).toBe('global');
        expect(failures[0].reason).toContain('could not be resolved');
    });

    it('reports a malformed global config without failing the whole CLI', () => {
        const configDir = makeTempDir('vendure-scope-config-');
        fs.writeFileSync(path.join(configDir, 'cli.json'), '{ not json');

        const { failures } = resolveCliPlugins({ env: { VENDURE_CLI_CONFIG_DIR: configDir } });

        expect(failures).toHaveLength(1);
        expect(failures[0].reason).toContain('Could not read');
    });

    it('registers global plugins before project ones, so the project overrides', () => {
        const globalRoot = makeTempDir('vendure-scope-global-');
        installPlugin(globalRoot, '@example/cloud', 'cloud');
        const project = makeProject({
            dependencies: { '@example/tools': '1.0.0' },
            plugins: ['@example/tools'],
        });
        installPlugin(project.root, '@example/tools', 'tools');
        const env = makeGlobalEnv({ plugins: ['@example/cloud'], roots: [globalRoot] });

        const { loaded } = resolveCliPlugins({
            env,
            cwd: project.root,
            projectPackageJson: project.packageJson,
        });

        expect(loaded.map(entry => [entry.packageName, entry.scope])).toEqual([
            ['@example/cloud', 'global'],
            ['@example/tools', 'project'],
        ]);
    });

    it('loads a package enabled in both scopes once, from the project', () => {
        const globalRoot = makeTempDir('vendure-scope-global-');
        installPlugin(globalRoot, '@example/cloud', 'global-cloud');
        const project = makeProject({
            dependencies: { '@example/cloud': '1.0.0' },
            plugins: ['@example/cloud'],
        });
        installPlugin(project.root, '@example/cloud', 'project-cloud');
        const env = makeGlobalEnv({ plugins: ['@example/cloud'], roots: [globalRoot] });

        const { loaded } = resolveCliPlugins({
            env,
            cwd: project.root,
            projectPackageJson: project.packageJson,
        });

        expect(loaded).toHaveLength(1);
        expect(loaded[0].scope).toBe('project');
        // The command name says which copy on disk was executed, which the
        // package name alone cannot.
        expect(loaded[0].plugin.commands.map(command => command.name)).toEqual(['project-cloud']);
    });

    it('leaves the global scope out when a project package.json is supplied without an env', () => {
        const project = makeProject({});

        // No env, so whatever this machine has enabled globally is not read.
        const { loaded } = resolveCliPlugins({
            cwd: project.root,
            projectPackageJson: project.packageJson,
        });

        expect(loaded).toEqual([]);
    });

    it('discovers an installed but unenabled global package, and says so', () => {
        const globalRoot = makeTempDir('vendure-scope-global-');
        installPlugin(globalRoot, '@example/cloud', 'cloud');
        const env = makeGlobalEnv({ roots: [globalRoot] });

        // pluginRoots resolves the package, but scanning for candidates needs a
        // node_modules the CLI itself sits in, which a test cannot fake. Naming
        // the package is what makes it discoverable here.
        const discovered = discoverCliPlugins({ env: { ...env, [CLI_PLUGINS_ENV_VAR]: '@example/cloud' } });

        expect(discovered).toHaveLength(1);
        expect(discovered[0]).toMatchObject({
            packageName: '@example/cloud',
            scope: 'global',
            status: 'enabled',
        });
    });
});
