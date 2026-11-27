import path from 'node:path';

import { DEFAULT_CONSOLE_API_URL, classifyConsoleApiOrigin } from '../commands/console/console-origins.js';
import { getVendureCliConfigDir } from '../shared/cli-config-dir.js';

import { authEnvironment } from './startup-environment.js';

/**
 * Seams for the CLI login. Every field is optional and defaults to the real
 * process, so a plugin calls these functions with no arguments.
 *
 * @since 3.8.0
 */
export interface AuthOptions {
    /**
     * Read for `VENDURE_CONSOLE_API_URL`, which selects the staging Console or a
     * loopback Console in local development. In the CLI, `VENDURE_CLOUD_TOKEN`
     * and the config directory, which holds the credential file, are always the
     * ones the CLI started with. Outside it, they are read from here too.
     */
    env?: NodeJS.ProcessEnv;
    fetch?: typeof globalThis.fetch;
    now?: () => number;
    signal?: AbortSignal;
}

/**
 * The Vendure Console the CLI signs in to: production unless
 * `VENDURE_CONSOLE_API_URL` names the official staging API or a loopback API.
 * Any other value is refused, so the access token is never sent anywhere else.
 * The WorkOS client is read from this Console at login.
 */
export function resolveConsoleApiUrl(options: AuthOptions = {}): string {
    const apiUrl = authEnvironment(options.env).VENDURE_CONSOLE_API_URL?.trim();
    if (!apiUrl) {
        return DEFAULT_CONSOLE_API_URL;
    }
    const consoleApi = classifyConsoleApiOrigin(apiUrl);
    if (!consoleApi) {
        throw new Error(
            'VENDURE_CONSOLE_API_URL is not a Vendure Console API. Use https://staging.api.vendure.io for ' +
                'staging, a loopback URL for local development, or unset it.',
        );
    }
    return consoleApi.apiOrigin;
}

export function getAuthFilePath(options: AuthOptions = {}): string {
    return path.join(getVendureCliConfigDir(authEnvironment(options.env)), 'auth.json');
}

export function getAuthLockPath(options: AuthOptions = {}): string {
    return path.join(getVendureCliConfigDir(authEnvironment(options.env)), 'auth.lock');
}

/** The device login that `vendure auth login --json` started and `vendure auth wait` finishes. */
export function getPendingLoginPath(options: AuthOptions = {}): string {
    return path.join(getVendureCliConfigDir(authEnvironment(options.env)), 'auth-pending.json');
}

export function getPendingLoginLockPath(options: AuthOptions = {}): string {
    return path.join(getVendureCliConfigDir(authEnvironment(options.env)), 'auth-pending.lock');
}

/** How the last pending device login ended, for a wait that queued behind the one that finished it. */
export function getFinishedLoginPath(options: AuthOptions = {}): string {
    return path.join(getVendureCliConfigDir(authEnvironment(options.env)), 'auth-pending-outcome.json');
}
