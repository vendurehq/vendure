import { isIncompleteResult } from '@vendure/common/lib/command';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeSecretFile } from '../command-host/secret-file.js';
import { DEFAULT_CONSOLE_API_URL } from '../commands/console/console-origins.js';
import { getVendureCliConfigDir } from '../shared/cli-config-dir.js';
import { getGlobalCliConfigPath } from '../shared/cli-global-plugin-config.js';
import { loadVendureConfigFromPath } from '../shared/load-vendure-config-file.js';
import { clearStartupRecord } from '../shared/startup-record.js';

import { getAuthFilePath, resolveConsoleApiUrl } from './auth-options.js';
import { readCloudTokenEnv, requireCredential } from './credential.js';
import { authEnvironment, recordStartupEnvironment } from './startup-environment.js';

const AUTH_VARIABLES = ['VENDURE_CLOUD_TOKEN', 'VENDURE_CONSOLE_API_URL', 'VENDURE_CLI_CONFIG_DIR'] as const;

describe('the auth variables a project .env sets', () => {
    let projectDir: string;
    let configDir: string;
    const cwd = process.cwd();
    const saved = Object.fromEntries(
        [...AUTH_VARIABLES, 'XDG_CONFIG_HOME'].map(name => [name, process.env[name]]),
    );

    beforeEach(() => {
        projectDir = mkdtempSync(path.join(tmpdir(), 'vendure-cli-dotenv-'));
        configDir = mkdtempSync(path.join(tmpdir(), 'vendure-cli-config-'));
        // A cloned repository's .env, which tries to choose the credential, where it is sent, and
        // where the login is read from.
        writeFileSync(
            path.join(projectDir, '.env'),
            [
                'VENDURE_CLOUD_TOKEN=vcdk_from_the_repository',
                'VENDURE_CONSOLE_API_URL=http://127.0.0.1:9',
                `VENDURE_CLI_CONFIG_DIR=${path.join(projectDir, 'stolen')}`,
            ].join('\n'),
        );
        writeFileSync(path.join(projectDir, 'tsconfig.json'), '{ "compilerOptions": {} }');
        writeFileSync(
            path.join(projectDir, 'vendure-config.js'),
            'module.exports = { config: { dbConnectionOptions: {} } };\n',
        );
        for (const name of AUTH_VARIABLES) {
            delete process.env[name];
        }
        // The CLI started with no token, and with no VENDURE_CLI_CONFIG_DIR, so the .env can set it.
        // The config directory comes from XDG_CONFIG_HOME instead.
        process.env.XDG_CONFIG_HOME = configDir;
        recordStartupEnvironment();
        process.chdir(projectDir);
    });

    afterEach(() => {
        process.chdir(cwd);
        clearStartupRecord();
        for (const [name, value] of Object.entries(saved)) {
            if (value === undefined) {
                delete process.env[name];
            } else {
                process.env[name] = value;
            }
        }
        rmSync(projectDir, { recursive: true, force: true });
        rmSync(configDir, { recursive: true, force: true });
    });

    it('are loaded into the environment with the Vendure config, but never read by the auth code', async () => {
        await loadVendureConfigFromPath(path.join(projectDir, 'vendure-config.js'));
        // The .env was loaded, as it is for the project's own code.
        expect(process.env.VENDURE_CLOUD_TOKEN).toBe('vcdk_from_the_repository');
        expect(process.env.VENDURE_CLI_CONFIG_DIR).toBe(path.join(projectDir, 'stolen'));

        const startupDir = path.join(configDir, 'vendure');
        expect(readCloudTokenEnv()).toBeUndefined();
        expect(resolveConsoleApiUrl()).toBe(DEFAULT_CONSOLE_API_URL);
        expect(getAuthFilePath()).toBe(path.join(startupDir, 'auth.json'));
        const found = await requireCredential({ mayPrompt: false });
        expect(isIncompleteResult(found)).toBe(true);

        // A CLI child started with this environment doesn't get the token: the key is there with no
        // value, which spawn leaves out.
        const child = authEnvironment();
        expect(child).toHaveProperty('VENDURE_CLOUD_TOKEN', undefined);
        expect(child.VENDURE_CLI_CONFIG_DIR).toBe(startupDir);
    });

    it('stay out of an env a plugin builds from process.env to choose the Console API URL', async () => {
        await loadVendureConfigFromPath(path.join(projectDir, 'vendure-config.js'));
        // dotenv loads only once per process, so the values the .env set are written in here.
        const env = {
            ...process.env,
            VENDURE_CLOUD_TOKEN: 'vcdk_from_the_repository',
            VENDURE_CLI_CONFIG_DIR: path.join(projectDir, 'stolen'),
            VENDURE_CONSOLE_API_URL: 'https://staging.api.vendure.io',
        };

        expect(readCloudTokenEnv({ env })).toBeUndefined();
        expect(resolveConsoleApiUrl({ env })).toBe('https://staging.api.vendure.io');
        expect(getAuthFilePath({ env })).toBe(path.join(configDir, 'vendure', 'auth.json'));
    });
});

describe('a project .env that moves the config directory it falls back to', () => {
    const FALLBACK_VARIABLES = ['VENDURE_CLI_CONFIG_DIR', 'XDG_CONFIG_HOME', 'HOME'] as const;
    const saved = Object.fromEntries(FALLBACK_VARIABLES.map(name => [name, process.env[name]]));
    let homeDir: string;

    beforeEach(() => {
        homeDir = mkdtempSync(path.join(tmpdir(), 'vendure-cli-home-'));
        // The usual setup: no VENDURE_CLI_CONFIG_DIR and no XDG_CONFIG_HOME, so the directory is in
        // the home directory.
        delete process.env.VENDURE_CLI_CONFIG_DIR;
        delete process.env.XDG_CONFIG_HOME;
        process.env.HOME = homeDir;
        recordStartupEnvironment();
    });

    afterEach(() => {
        clearStartupRecord();
        for (const [name, value] of Object.entries(saved)) {
            if (value === undefined) {
                delete process.env[name];
            } else {
                process.env[name] = value;
            }
        }
        rmSync(homeDir, { recursive: true, force: true });
    });

    // On Windows the home directory comes from USERPROFILE, which this test doesn't set up.
    it.skipIf(process.platform === 'win32')(
        'keeps the login, cli.json, secret files and CLI children in the startup directory',
        () => {
            // What a repository's .env does once it is loaded. dotenv only loads once per process, and
            // the spec above loads a real one.
            process.env.XDG_CONFIG_HOME = path.join(homeDir, 'stolen');
            process.env.HOME = path.join(homeDir, 'stolen-home');

            const startupDir = path.join(homeDir, '.config', 'vendure');
            expect(getVendureCliConfigDir()).toBe(startupDir);
            expect(getAuthFilePath()).toBe(path.join(startupDir, 'auth.json'));
            expect(getGlobalCliConfigPath()).toBe(path.join(startupDir, 'cli.json'));
            expect(writeSecretFile(['test'], 'secret', 'value').startsWith(startupDir)).toBe(true);
            // A CLI child started with this environment records the same directory.
            expect(authEnvironment().VENDURE_CLI_CONFIG_DIR).toBe(startupDir);
        },
    );
});

describe('authEnvironment outside the CLI', () => {
    afterEach(() => clearStartupRecord());

    it('reads the process environment as it is when nothing recorded it, and an env it is given', () => {
        clearStartupRecord();
        expect(readCloudTokenEnv({ env: { VENDURE_CLOUD_TOKEN: 'given' } })).toBe('given');
        const saved = process.env.VENDURE_CLOUD_TOKEN;
        process.env.VENDURE_CLOUD_TOKEN = 'live';
        try {
            expect(readCloudTokenEnv()).toBe('live');
        } finally {
            if (saved === undefined) {
                delete process.env.VENDURE_CLOUD_TOKEN;
            } else {
                process.env.VENDURE_CLOUD_TOKEN = saved;
            }
        }
    });
});
