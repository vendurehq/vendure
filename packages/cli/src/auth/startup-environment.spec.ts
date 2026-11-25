import { isIncompleteResult } from '@vendure/common/lib/command';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadVendureConfigFromPath } from '../shared/load-vendure-config-file.js';

import { getAuthFilePath, resolveConsoleApiUrl } from './auth-options.js';
import { readCloudTokenEnv, requireCredential } from './credential.js';
import {
    AUTH_ENVIRONMENT_VARIABLES,
    clearStartupEnvironment,
    recordStartupEnvironment,
} from './startup-environment.js';

describe('the auth variables a project .env sets', () => {
    let projectDir: string;
    let configDir: string;
    const cwd = process.cwd();
    const saved = Object.fromEntries(AUTH_ENVIRONMENT_VARIABLES.map(name => [name, process.env[name]]));

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
        for (const name of AUTH_ENVIRONMENT_VARIABLES) {
            delete process.env[name];
        }
        // The CLI started with no token and its own config directory.
        process.env.VENDURE_CLI_CONFIG_DIR = configDir;
        recordStartupEnvironment();
        process.chdir(projectDir);
    });

    afterEach(() => {
        process.chdir(cwd);
        clearStartupEnvironment();
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

        expect(readCloudTokenEnv()).toBeUndefined();
        expect(resolveConsoleApiUrl()).toBe('https://api.vendure.io');
        expect(getAuthFilePath()).toBe(path.join(configDir, 'auth.json'));
        const found = await requireCredential({ mayPrompt: false });
        expect(isIncompleteResult(found)).toBe(true);
    });
});

describe('authEnvironment outside the CLI', () => {
    afterEach(() => clearStartupEnvironment());

    it('reads the process environment as it is when nothing recorded it, and an env it is given', () => {
        clearStartupEnvironment();
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
