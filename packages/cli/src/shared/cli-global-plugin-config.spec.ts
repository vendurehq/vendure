import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
    addGlobalPlugin,
    CLI_PLUGINS_ENV_VAR,
    getGlobalCliConfigPath,
    getGlobalPluginAllowlist,
    readGlobalCliConfig,
    removeGlobalPlugin,
} from './cli-global-plugin-config';

describe('global CLI plugin config', () => {
    const tempDirs: string[] = [];

    afterEach(() => {
        for (const dir of tempDirs.splice(0)) {
            fs.removeSync(dir);
        }
    });

    /**
     * An environment pointing the CLI at a config directory of its own, so no
     * test can read or write the config of the machine it runs on.
     */
    function makeEnv(contents?: unknown): NodeJS.ProcessEnv {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-cli-global-config-'));
        tempDirs.push(dir);
        if (contents !== undefined) {
            fs.writeJsonSync(path.join(dir, 'cli.json'), contents);
        }
        return { VENDURE_CLI_CONFIG_DIR: dir };
    }

    it('reads an empty allowlist when no config file exists', () => {
        expect(getGlobalPluginAllowlist(makeEnv())).toEqual([]);
    });

    it('reads the allowlist from the config file', () => {
        const env = makeEnv({ plugins: ['@vendure/cloud'] });

        expect(getGlobalPluginAllowlist(env)).toEqual(['@vendure/cloud']);
    });

    it('adds names from the environment variable', () => {
        const env = { ...makeEnv({ plugins: ['@vendure/cloud'] }), [CLI_PLUGINS_ENV_VAR]: '@example/other' };

        expect(getGlobalPluginAllowlist(env)).toEqual(['@vendure/cloud', '@example/other']);
    });

    it('works from the environment variable alone, with no config file', () => {
        const env = { ...makeEnv(), [CLI_PLUGINS_ENV_VAR]: '@vendure/cloud, @example/other' };

        expect(getGlobalPluginAllowlist(env)).toEqual(['@vendure/cloud', '@example/other']);
    });

    it('ignores blank entries, so a trailing comma is not a package', () => {
        const env = { ...makeEnv(), [CLI_PLUGINS_ENV_VAR]: '@vendure/cloud,,' };

        expect(getGlobalPluginAllowlist(env)).toEqual(['@vendure/cloud']);
    });

    it('does not list a package twice when the file and the variable agree', () => {
        const env = { ...makeEnv({ plugins: ['@vendure/cloud'] }), [CLI_PLUGINS_ENV_VAR]: '@vendure/cloud' };

        expect(getGlobalPluginAllowlist(env)).toEqual(['@vendure/cloud']);
    });

    it('reports a malformed config file instead of throwing', () => {
        const env = makeEnv();
        fs.writeFileSync(path.join(env.VENDURE_CLI_CONFIG_DIR as string, 'cli.json'), '{ not json');

        const result = readGlobalCliConfig(env);

        expect(result.error).toMatch(/JSON/);
        expect(result.config).toEqual({});
    });

    it('reports a config file that is not an object', () => {
        const env = makeEnv(['@vendure/cloud']);

        expect(readGlobalCliConfig(env).error).toBe('Expected a JSON object');
    });

    it('creates the config directory on the first add', () => {
        const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-cli-global-')), 'nested');
        tempDirs.push(path.dirname(dir));
        const env = { VENDURE_CLI_CONFIG_DIR: dir };

        const result = addGlobalPlugin('@vendure/cloud', env);

        expect(fs.existsSync(result.path)).toBe(true);
        expect(getGlobalPluginAllowlist(env)).toEqual(['@vendure/cloud']);
    });

    it('keeps other settings in the file when the allowlist changes', () => {
        const env = makeEnv({ plugins: [], pluginRoots: ['/opt/vendure-plugins'] });

        addGlobalPlugin('@vendure/cloud', env);

        expect(readGlobalCliConfig(env).config).toEqual({
            plugins: ['@vendure/cloud'],
            pluginRoots: ['/opt/vendure-plugins'],
        });
    });

    it('does not add a package twice', () => {
        const env = makeEnv({ plugins: ['@vendure/cloud'] });

        addGlobalPlugin('@vendure/cloud', env);

        expect(getGlobalPluginAllowlist(env)).toEqual(['@vendure/cloud']);
    });

    it('removes a package', () => {
        const env = makeEnv({ plugins: ['@vendure/cloud', '@example/other'] });

        removeGlobalPlugin('@vendure/cloud', env);

        expect(getGlobalPluginAllowlist(env)).toEqual(['@example/other']);
    });

    it('puts cli.json in the configured directory', () => {
        const env = { VENDURE_CLI_CONFIG_DIR: '/tmp/somewhere' };

        expect(getGlobalCliConfigPath(env)).toBe(path.join('/tmp/somewhere', 'cli.json'));
    });

    it('cannot remove a package the environment variable supplies', () => {
        // The variable is read at every invocation, so the file cannot
        // countermand it. Worth knowing rather than silently surprising.
        const env = { ...makeEnv({ plugins: [] }), [CLI_PLUGINS_ENV_VAR]: '@vendure/cloud' };

        removeGlobalPlugin('@vendure/cloud', env);

        expect(getGlobalPluginAllowlist(env)).toEqual(['@vendure/cloud']);
    });
});
