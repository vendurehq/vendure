import { CommandContext, failed } from '@vendure/common/lib/command';

import { checkAuthStatus, hasLoginForOtherConsole } from '../../auth/auth-session.js';
import { CLOUD_TOKEN_ENV, readCloudTokenEnv } from '../../auth/credential.js';

import {
    AuthCommandDependencies,
    describeLogin,
    describeOrganization,
    describeRefusal,
    invalidConsoleApi,
    ORGANIZATION_LOGIN_COMMAND,
} from './auth.js';
import { StatusOutput } from './auth.schema.js';

/**
 * Renews the stored login to check it, so a login the authentication service no longer renews
 * is reported instead of shown as logged in. It also says which credential commands use: the
 * stored login first, then `VENDURE_CLOUD_TOKEN`. Without either it is a failed result. The
 * output never holds a token.
 */
export function run(_input: Record<string, never>, ctx: CommandContext) {
    return runStatus(ctx);
}

export async function runStatus(ctx: CommandContext, dependencies: AuthCommandDependencies = {}) {
    const options = { ...dependencies, signal: ctx.signal };
    const invalid = invalidConsoleApi(options);
    if (invalid) {
        return invalid;
    }
    const login = await checkAuthStatus(options);
    const credential = login.loggedIn ? 'stored-login' : readCloudTokenEnv(options) ? 'environment' : 'none';
    const status: StatusOutput = { ...login, credential };
    if (!status.loggedIn && hasLoginForOtherConsole(options)) {
        status.otherConsoleLogin = true;
    }
    return credential === 'none' ? failed(status) : status;
}

export function render(status: StatusOutput): string {
    const environment =
        status.credential !== 'environment'
            ? undefined
            : status.renewable === false
              ? `Commands use ${CLOUD_TOKEN_ENV}, because the stored login can no longer be renewed.`
              : `Commands use ${CLOUD_TOKEN_ENV}, because no login is stored for ${status.consoleApiUrl}.`;
    if (status.renewable === false) {
        const refusal = describeRefusal(status, 'Run `vendure auth login` to sign in again.');
        return environment ? `${refusal}\n${environment}` : refusal;
    }
    if (environment) {
        return environment;
    }
    if (!status.loggedIn) {
        const notLoggedIn = ['Not logged in. Run `vendure auth login` to sign in.'];
        if (status.otherConsoleLogin) {
            notLoggedIn.push(
                `A login for another Vendure Console is stored in ${status.path}. ` +
                    'Check VENDURE_CONSOLE_API_URL, or sign in again to replace it.',
            );
        }
        return notLoggedIn.join('\n');
    }
    const lines = [`Logged in as ${describeLogin(status)}`];
    if (status.organization) {
        const unnamed = status.organization.name
            ? ''
            : ` (name unknown; run \`${ORGANIZATION_LOGIN_COMMAND}\` to choose it by name)`;
        lines.push(`Organization: ${describeOrganization(status.organization)}${unnamed}`);
    }
    if (status.accessTokenExpiresAt !== undefined) {
        lines.push(
            `Access token expires: ${new Date(status.accessTokenExpiresAt).toISOString()} (renewed automatically)`,
        );
    }
    lines.push(
        `Vendure Console: ${status.consoleApiUrl}`,
        `Authentication client: ${status.clientId ?? 'unknown'}`,
        `Stored in: ${status.path}`,
    );
    if (status.renewalError) {
        lines.push(`Could not check that the login can be renewed: ${status.renewalError.message}`);
    }
    return lines.join('\n');
}
