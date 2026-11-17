import path from 'node:path';

import { DEFAULT_CONSOLE_API_URL, classifyConsoleApiOrigin } from '../commands/console/console-origins';
import { getVendureCliConfigDir } from '../shared/cli-config-dir';

/**
 * Seams for the CLI login. Every field is optional and defaults to the real
 * process, so a plugin calls these functions with no arguments.
 *
 * @since 3.8.0
 */
export interface AuthOptions {
    /**
     * Read for `VENDURE_CONSOLE_API_URL`, which selects the staging Console or a
     * loopback Console in local development, and `VENDURE_CLI_CONFIG_DIR`, which
     * moves the credential file.
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
    const apiUrl = (options.env ?? process.env).VENDURE_CONSOLE_API_URL?.trim();
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
    return path.join(getVendureCliConfigDir(options.env ?? process.env), 'auth.json');
}

export function getAuthLockPath(options: AuthOptions = {}): string {
    return path.join(getVendureCliConfigDir(options.env ?? process.env), 'auth.lock');
}
