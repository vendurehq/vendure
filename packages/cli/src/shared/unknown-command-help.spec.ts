import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
    findEnabledPluginDeclaringCommand,
    findInactivePluginProvidingCommand,
    listInactiveCliPlugins,
    PackageJsonLike,
    ResolveCliPluginsOptions,
} from './resolve-cli-plugins';
import { unknownCommandHelp } from './unknown-command-help';

/**
 * A machine with `@vendure/cli` installed globally and a project beside it,
 * so a package can be installed, and enabled or not, in either scope.
 */
describe('unknown command help', () => {
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

    function installPlugin(root: string, packageName: string, cliCommands?: string[]): void {
        const dir = path.join(root, 'node_modules', ...packageName.split('/'));
        fs.ensureDirSync(dir);
        fs.writeJsonSync(path.join(dir, 'package.json'), {
            name: packageName,
            version: '1.0.0',
            vendure: { cliPlugin: './cli-plugin.js', ...(cliCommands ? { cliCommands } : {}) },
        });
        fs.writeFileSync(
            path.join(dir, 'cli-plugin.js'),
            `module.exports = { id: '${packageName}', commands: [] };\n`,
        );
    }

    function makeMachine(options: {
        global?: { installed: Array<[string, string[]?]>; enabled?: string[] };
        project?: { installed: Array<[string, string[]?]>; enabled?: string[] };
    }): ResolveCliPluginsOptions {
        const globalRoot = makeTempDir('vendure-unknown-global-');
        const globalNodeModules = path.join(globalRoot, 'node_modules');
        const packageDir = path.join(globalNodeModules, '@vendure', 'cli');
        fs.ensureDirSync(packageDir);
        for (const [name, commands] of options.global?.installed ?? []) {
            installPlugin(globalRoot, name, commands);
        }
        const configDir = makeTempDir('vendure-unknown-config-');
        fs.writeJsonSync(path.join(configDir, 'cli.json'), { plugins: options.global?.enabled ?? [] });

        const projectRoot = makeTempDir('vendure-unknown-project-');
        const projectPackageJson: PackageJsonLike = {
            name: 'shop',
            dependencies: Object.fromEntries(
                (options.project?.installed ?? []).map(([name]) => [name, '1.0.0']),
            ),
            vendure: { cli: { plugins: options.project?.enabled ?? [] } },
        };
        fs.writeJsonSync(path.join(projectRoot, 'package.json'), projectPackageJson);
        for (const [name, commands] of options.project?.installed ?? []) {
            installPlugin(projectRoot, name, commands);
        }

        return {
            cwd: projectRoot,
            projectPackageJson,
            env: { VENDURE_CLI_CONFIG_DIR: configDir },
            findCliInstall: () => ({ packageDir, globalNodeModules }),
        };
    }

    // Enabled for the project, installed globally too.
    it('does not call a package enabled for the project "not enabled"', () => {
        const options = makeMachine({
            global: { installed: [['@example/cloud', ['cloud']]] },
            project: { installed: [['@example/cloud', ['cloud']]], enabled: ['@example/cloud'] },
        });

        expect(listInactiveCliPlugins(options)).toEqual([]);
        expect(findInactivePluginProvidingCommand('cloud', options)).toBeUndefined();
        expect(unknownCommandHelp('bogus', options, new Map())).toEqual(['Unknown command "bogus".']);
    });

    it('names a plugin only when it declares the command', () => {
        const options = makeMachine({
            global: { installed: [['@example/cloud', ['cloud']]] },
        });

        expect(unknownCommandHelp('bogus', options, new Map())).toEqual(['Unknown command "bogus".']);
        expect(unknownCommandHelp('cloud', options, new Map())).toEqual([
            'Unknown command "cloud".',
            'It is provided by @example/cloud, which is installed but not enabled.',
            'Enable it with: vendure plugins add --global @example/cloud',
        ]);
    });

    it('suggests the project command when the package is a project dependency too', () => {
        const options = makeMachine({
            global: { installed: [['@example/cloud', ['cloud']]] },
            project: { installed: [['@example/cloud', ['cloud']]] },
        });

        expect(listInactiveCliPlugins(options).map(plugin => plugin.scope)).toEqual(['project']);
        expect(unknownCommandHelp('cloud', options, new Map())).toContain(
            'Enable it with: vendure plugins add @example/cloud',
        );
    });

    it('leaves inactive packages that declare no commands to the startup hint', () => {
        const options = makeMachine({
            project: {
                installed: [['@example/cloud', ['cloud']], ['@example/tools'], ['@example/more']],
            },
        });

        expect(unknownCommandHelp('bogus', options, new Map())).toEqual(['Unknown command "bogus".']);
    });

    it('says an enabled plugin that failed to load did not register its command', () => {
        const options = makeMachine({
            project: { installed: [['@example/cloud', ['cloud']]], enabled: ['@example/cloud'] },
        });

        expect(findEnabledPluginDeclaringCommand('cloud', options)?.packageName).toBe('@example/cloud');
        expect(unknownCommandHelp('cloud', options, new Map([['@example/cloud', 'load']]))).toEqual([
            'Unknown command "cloud".',
            '@example/cloud is enabled but did not register "cloud". It failed to load; see the error above.',
        ]);
    });

    it('says an enabled plugin that failed to register did not register its command', () => {
        const options = makeMachine({
            project: { installed: [['@example/cloud', ['cloud']]], enabled: ['@example/cloud'] },
        });

        expect(unknownCommandHelp('cloud', options, new Map([['@example/cloud', 'register']]))).toContain(
            '@example/cloud is enabled but did not register "cloud". It failed to register; see the error above.',
        );
    });

    it('names an inactive global copy that declares the command when the project copy does not', () => {
        const options = makeMachine({
            global: { installed: [['@example/cloud', ['cloud']]] },
            project: { installed: [['@example/cloud']] },
        });

        expect(unknownCommandHelp('cloud', options, new Map())).toContain(
            'Enable it with: vendure plugins add --global @example/cloud',
        );
    });

    it('reads the enabled copy startup loads, which is the project one', () => {
        const options = makeMachine({
            global: { installed: [['@example/cloud', ['cloud']]], enabled: ['@example/cloud'] },
            project: { installed: [['@example/cloud']], enabled: ['@example/cloud'] },
        });

        expect(findEnabledPluginDeclaringCommand('cloud', options)).toBeUndefined();
        expect(unknownCommandHelp('cloud', options, new Map())).toEqual(['Unknown command "cloud".']);
    });

    it('says an enabled plugin declares a command it does not provide', () => {
        const options = makeMachine({
            global: { installed: [['@example/cloud', ['cloud']]], enabled: ['@example/cloud'] },
        });

        expect(unknownCommandHelp('cloud', options, new Map())).toEqual([
            'Unknown command "cloud".',
            '@example/cloud is enabled but did not register "cloud". ' +
                'Its vendure.cliCommands lists "cloud", but the plugin does not provide it.',
        ]);
    });

    it('names an inactive plugin that declares the command when an enabled one did not register it', () => {
        const options = makeMachine({
            project: {
                installed: [
                    ['@example/broken', ['cloud']],
                    ['@example/cloud', ['cloud']],
                ],
                enabled: ['@example/broken'],
            },
        });

        expect(unknownCommandHelp('cloud', options, new Map())).toEqual([
            'Unknown command "cloud".',
            '@example/broken is enabled but did not register "cloud". ' +
                'Its vendure.cliCommands lists "cloud", but the plugin does not provide it.',
            '"cloud" is also provided by @example/cloud, which is installed but not enabled.',
            'Enable it with: vendure plugins add @example/cloud',
        ]);
    });
});
