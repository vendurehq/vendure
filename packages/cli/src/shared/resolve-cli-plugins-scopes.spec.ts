import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { CLI_PLUGINS_ENV_VAR } from './cli-global-plugin-config';
import {
    CliInstallLocation,
    discoverCliPlugins,
    findCliInstallLocation,
    PackageJsonLike,
    resolveCliPlugins,
} from './resolve-cli-plugins';

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
    function makeProject(options: { dependencies?: Record<string, string>; plugins?: string[] }): {
        root: string;
        packageJson: PackageJsonLike;
    } {
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

    it('reports a malformed global config as a scope problem, not a broken package', () => {
        const configDir = makeTempDir('vendure-scope-config-');
        const configPath = path.join(configDir, 'cli.json');
        fs.writeFileSync(configPath, '{ not json');

        const { failures, scopeErrors } = resolveCliPlugins({
            env: { VENDURE_CLI_CONFIG_DIR: configDir },
        });

        // A file is not a package: reporting it as one produced advice to
        // "remove" a plugin named after a path, which could never work.
        expect(failures).toEqual([]);
        expect(scopeErrors).toEqual([
            { scope: 'global', origin: configPath, reason: expect.stringContaining(configPath) },
        ]);
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

    it('considers only the scopes it is asked for', () => {
        const globalRoot = makeTempDir('vendure-scope-global-');
        installPlugin(globalRoot, '@example/cloud', 'cloud');
        const env = makeGlobalEnv({ plugins: ['@example/cloud'], roots: [globalRoot] });
        const project = makeProject({});

        const { loaded } = resolveCliPlugins({
            env,
            cwd: project.root,
            projectPackageJson: project.packageJson,
            scopes: ['project'],
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

describe('findCliInstallLocation()', () => {
    const tempDirs: string[] = [];

    afterEach(() => {
        for (const dir of tempDirs.splice(0)) {
            fs.removeSync(dir);
        }
    });

    /**
     * A CLI package installed at `<root>/node_modules/@vendure/cli`, returning
     * the directory inside it that `__dirname` would be at runtime.
     */
    function installCli(root: string, projectPackageJson?: Record<string, unknown>): string {
        const dir = path.join(root, 'node_modules', '@vendure', 'cli');
        fs.ensureDirSync(path.join(dir, 'dist', 'shared'));
        fs.writeJsonSync(path.join(dir, 'package.json'), {
            name: '@vendure/cli',
            version: '3.8.0',
            dependencies: { '@vendure/common': '3.8.0' },
        });
        if (projectPackageJson) {
            fs.writeJsonSync(path.join(root, 'package.json'), projectPackageJson);
        }
        return path.join(dir, 'dist', 'shared');
    }

    /**
     * Returned as a real path, because the lookup resolves symlinks and the
     * system temp directory is one on macOS.
     */
    function makeRoot(): string {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-install-'));
        tempDirs.push(dir);
        return fs.realpathSync(dir);
    }

    it('treats a node_modules with no project above it as a global installation', () => {
        // <prefix>/lib/node_modules/@vendure/cli, with nothing above claiming
        // to be a Vendure project.
        const prefix = path.join(makeRoot(), 'lib');
        const fromDir = installCli(prefix);

        const location = findCliInstallLocation(fromDir);

        expect(location?.globalNodeModules).toBe(path.join(prefix, 'node_modules'));
    });

    /**
     * `@vendure/cli` is most often a project devDependency, so the node_modules
     * it sits in is the project's own and not a global root.
     */
    it('does not treat a project node_modules as a global installation', () => {
        const project = makeRoot();
        const fromDir = installCli(project, {
            name: 'shop',
            devDependencies: { '@vendure/cli': '3.8.0' },
        });

        const location = findCliInstallLocation(fromDir);

        expect(location?.packageDir).toBe(path.join(project, 'node_modules', '@vendure', 'cli'));
        expect(location?.globalNodeModules).toBeUndefined();
    });

    /**
     * A workspace root's manifest carries `workspaces` and shared tooling, with
     * the Vendure dependency in a package below the hoisted node_modules.
     */
    it('does not treat a hoisted workspace node_modules as a global installation', () => {
        const repo = makeRoot();
        const fromDir = installCli(repo, {
            name: 'repo',
            workspaces: ['packages/*'],
            devDependencies: { typescript: '5.8.2' },
        });
        fs.ensureDirSync(path.join(repo, 'packages', 'server'));
        fs.writeJsonSync(path.join(repo, 'packages', 'server', 'package.json'), {
            name: 'server',
            dependencies: { '@vendure/core': '3.8.0' },
        });

        expect(findCliInstallLocation(fromDir)?.globalNodeModules).toBeUndefined();
    });

    /**
     * nvm ships a package.json at the root of its own directory, so a global
     * root cannot be recognised by the absence of a manifest in *every*
     * ancestor — only in the directory that holds the node_modules.
     */
    it('treats a global root as global even when an ancestor has a package.json', () => {
        const home = makeRoot();
        const prefix = path.join(home, 'versions', 'node', 'v24.0.0', 'lib');
        fs.ensureDirSync(home);
        fs.writeJsonSync(path.join(home, 'package.json'), { name: 'nvm' });
        const fromDir = installCli(prefix);

        expect(findCliInstallLocation(fromDir)?.globalNodeModules).toBe(path.join(prefix, 'node_modules'));
    });

    it('finds no global node_modules for a source checkout', () => {
        const checkout = makeRoot();
        const dir = path.join(checkout, 'packages', 'cli', 'src');
        fs.ensureDirSync(dir);
        fs.writeJsonSync(path.join(checkout, 'packages', 'cli', 'package.json'), { name: '@vendure/cli' });

        expect(findCliInstallLocation(dir)?.globalNodeModules).toBeUndefined();
    });
});

describe('the global scope with a project-local CLI', () => {
    const tempDirs: string[] = [];

    afterEach(() => {
        for (const dir of tempDirs.splice(0)) {
            fs.removeSync(dir);
        }
    });

    it('offers nothing, so a project dependency is never reported as machine-wide', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-local-cli-'));
        tempDirs.push(root);
        const toolsDir = path.join(root, 'node_modules', '@example', 'tools');
        fs.ensureDirSync(toolsDir);
        fs.writeJsonSync(path.join(toolsDir, 'package.json'), {
            name: '@example/tools',
            vendure: { cliPlugin: './p.js', cliCommands: ['tools'] },
        });
        fs.writeFileSync(path.join(toolsDir, 'p.js'), 'module.exports={id:"t",commands:[]};\n');
        const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-local-cfg-'));
        tempDirs.push(configDir);
        fs.writeJsonSync(path.join(configDir, 'cli.json'), { plugins: [] });

        // A project-local install: a package directory, but no global one.
        const projectLocal: CliInstallLocation = {
            packageDir: path.join(root, 'node_modules', '@vendure', 'cli'),
        };

        const discovered = discoverCliPlugins({
            env: { VENDURE_CLI_CONFIG_DIR: configDir },
            scopes: ['global'],
            findCliInstall: () => projectLocal,
        });

        expect(discovered).toEqual([]);
    });
});
