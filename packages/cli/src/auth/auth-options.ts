import path from 'node:path';

import {
    ConsoleOriginEnvironment,
    classifyConsoleApiOrigin,
    officialConsoleApiUrl,
} from '../commands/console/console-origins';
import { getVendureCliConfigDir } from '../shared/cli-config-dir';

/**
 * A WorkOS client and the Vendure Console API that accepts its tokens.
 *
 * The CLI sends the user's access token to this API, so the API is never chosen
 * independently of the client that issued the token: a staging token is not
 * sent to production, and no environment variable can send it to a host Vendure
 * does not run. The official Console origins live in `console-origins.ts`.
 */
export interface AuthEnvironment {
    workosClientId: string;
    consoleApiUrl: string;
}

/**
 * The WorkOS client whose tokens each official Console accepts. A client id is
 * public: it identifies the application, and the device flow needs no secret.
 */
const WORKOS_CLIENT_IDS: Readonly<Record<ConsoleOriginEnvironment, string>> = {
    // TODO(OSS-848): replace with the Console application of the production
    // WorkOS environment before 3.8.0 is released. That application does not
    // exist yet; this is the environment's shared application, which production
    // Console is not expected to accept.
    production: 'client_01KHNB7M339M2RH2MB672QYCVZ',
    staging: 'client_01M1413F2Y0A4Q2JWGYC4Z8T5R',
};

export const PRODUCTION_AUTH_ENVIRONMENT = officialAuthEnvironment('production');
export const STAGING_AUTH_ENVIRONMENT = officialAuthEnvironment('staging');

export const WORKOS_DEVICE_AUTHORIZE_URL = 'https://api.workos.com/user_management/authorize/device';
export const WORKOS_AUTHENTICATE_URL = 'https://api.workos.com/user_management/authenticate';

/**
 * Seams for the CLI login. Every field is optional and defaults to the real
 * process, so a plugin calls these functions with no arguments.
 *
 * @since 3.8.0
 */
export interface AuthOptions {
    /**
     * Read for `VENDURE_CONSOLE_API_URL`, which selects the staging Console (and
     * with it the staging WorkOS client) or a loopback Console in local
     * development; `VENDURE_AUTH_CLIENT_ID`, the WorkOS client for a loopback
     * Console; and `VENDURE_CLI_CONFIG_DIR`, which moves the credential file.
     */
    env?: NodeJS.ProcessEnv;
    fetch?: typeof globalThis.fetch;
    now?: () => number;
    signal?: AbortSignal;
}

/**
 * Production unless `VENDURE_CONSOLE_API_URL` says otherwise. An official
 * Console API selects that environment's client. A loopback API is local
 * development: it uses `VENDURE_AUTH_CLIENT_ID`, or the staging client without
 * it. Any other value is refused, so the token is never sent anywhere else.
 */
export function resolveAuthEnvironment(options: AuthOptions = {}): AuthEnvironment {
    const env = options.env ?? process.env;
    const apiUrl = env.VENDURE_CONSOLE_API_URL?.trim();
    const clientId = env.VENDURE_AUTH_CLIENT_ID?.trim();
    const consoleApi = apiUrl ? classifyConsoleApiOrigin(apiUrl) : undefined;
    if (consoleApi?.environment === 'loopback') {
        return { workosClientId: clientId || WORKOS_CLIENT_IDS.staging, consoleApiUrl: consoleApi.apiOrigin };
    }
    if (clientId) {
        throw new Error('VENDURE_AUTH_CLIENT_ID can only be used with a loopback VENDURE_CONSOLE_API_URL.');
    }
    if (!apiUrl) {
        return PRODUCTION_AUTH_ENVIRONMENT;
    }
    if (!consoleApi) {
        throw new Error(
            'VENDURE_CONSOLE_API_URL is not a Vendure Console API. ' +
                `Use ${STAGING_AUTH_ENVIRONMENT.consoleApiUrl} for staging, a loopback URL for local development, or unset it.`,
        );
    }
    return officialAuthEnvironment(consoleApi.environment);
}

function officialAuthEnvironment(environment: ConsoleOriginEnvironment): AuthEnvironment {
    return {
        workosClientId: WORKOS_CLIENT_IDS[environment],
        consoleApiUrl: officialConsoleApiUrl(environment),
    };
}

export function resolveClientId(options: AuthOptions = {}): string {
    return resolveAuthEnvironment(options).workosClientId;
}

/** The Console API to send this login's access token to. */
export function resolveConsoleApiUrl(options: AuthOptions = {}): string {
    return resolveAuthEnvironment(options).consoleApiUrl;
}

export function getAuthFilePath(options: AuthOptions = {}): string {
    return path.join(getVendureCliConfigDir(options.env ?? process.env), 'auth.json');
}

export function getAuthLockPath(options: AuthOptions = {}): string {
    return path.join(getVendureCliConfigDir(options.env ?? process.env), 'auth.lock');
}
