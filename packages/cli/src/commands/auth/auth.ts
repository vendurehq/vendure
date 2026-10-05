import { confirm, isCancel, log } from '@clack/prompts';

import {
    AuthStatus,
    DeviceLoginOptions,
    LogoutResult,
    loginWithDevice,
    logout,
    readAuthStatus,
} from '../../auth';
import { AuthOptions, resolveConsoleApiUrl } from '../../auth/auth-options';
import { hasLoginForOtherConsole } from '../../auth/auth-session';
import { StoredOrganization } from '../../auth/auth-store';
import { isNonInteractiveEnvironment, withInteractiveTimeout } from '../../utilities/utils';
import { openConsoleBrowser } from '../console/authentication';

export interface AuthCommandReporter {
    error(message: string): void;
    info(message: string): void;
    success(message: string): void;
    warn(message: string): void;
}

export interface AuthCommandDependencies extends AuthOptions {
    reporter: AuthCommandReporter;
    /** Resolves `undefined` when the prompt was cancelled. */
    confirm(message: string): Promise<boolean | undefined>;
    isNonInteractive(): boolean;
    openUrl(url: string): Promise<void>;
    writeStdout(value: string): void;
}

function createDefaultDependencies(): AuthCommandDependencies {
    return {
        reporter: {
            error: message => log.error(message),
            info: message => log.info(message),
            success: message => log.success(message),
            warn: message => log.warn(message),
        },
        confirm: async message => {
            const result = await withInteractiveTimeout(() => confirm({ message, initialValue: false }), {
                examples: ['vendure auth logout', 'vendure auth login'],
                helpCommands: ['vendure auth --help'],
            });
            return isCancel(result) ? undefined : result;
        },
        isNonInteractive: () => isNonInteractiveEnvironment(),
        openUrl: openConsoleBrowser,
        writeStdout: value => process.stdout.write(value),
    };
}

function resolveDependencies(dependencies: Partial<AuthCommandDependencies>): AuthCommandDependencies {
    return { ...createDefaultDependencies(), ...dependencies };
}

export async function authLoginCommand(
    options: { organization?: string } = {},
    dependencies: Partial<AuthCommandDependencies> = {},
): Promise<number> {
    const deps = resolveDependencies(dependencies);
    const organization = options.organization?.trim() || undefined;
    if (!hasValidEnvironment(deps)) {
        return 1;
    }
    const existing = readAuthStatus(deps);
    if (existing.loggedIn && !deps.isNonInteractive()) {
        const replace = await deps.confirm(
            `Already logged in as ${existing.user?.email ?? 'an unknown user'}. Sign in again?`,
        );
        if (!replace) {
            deps.reporter.info('Login cancelled.');
            return 0;
        }
    }

    const abortController = new AbortController();
    const onSignal = () => abortController.abort();
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
    const loginOptions: DeviceLoginOptions = {
        ...deps,
        signal: abortController.signal,
        organization,
        onDeviceAuthorization: async device => {
            deps.reporter.info(
                `Confirm this code in your browser: ${device.userCode}\n` +
                    `If the browser does not open, visit ${device.verificationUriComplete}`,
            );
            try {
                await deps.openUrl(device.verificationUriComplete);
            } catch {
                // The URL is already on screen.
            }
            deps.reporter.info('Waiting for approval...');
        },
    };
    try {
        const status = await loginWithDevice(loginOptions);
        const scope = status.organization ? ` to ${describeOrganization(status.organization)}` : '';
        deps.reporter.success(`Logged in as ${describeLogin(status)}${scope}.`);
        return 0;
    } catch (error) {
        if (abortController.signal.aborted) {
            deps.reporter.warn('Login interrupted.');
            return 130;
        }
        deps.reporter.error(error instanceof Error ? error.message : 'The login failed.');
        return 1;
    } finally {
        process.removeListener('SIGINT', onSignal);
        process.removeListener('SIGTERM', onSignal);
    }
}

export function authStatusCommand(
    options: { json?: boolean } = {},
    dependencies: Partial<AuthCommandDependencies> = {},
): number {
    const deps = resolveDependencies(dependencies);
    if (!hasValidEnvironment(deps)) {
        return 1;
    }
    const status = readAuthStatus(deps);
    if (options.json) {
        deps.writeStdout(`${JSON.stringify(status)}\n`);
        return status.loggedIn ? 0 : 1;
    }
    if (!status.loggedIn) {
        deps.reporter.warn('Not logged in. Run `vendure auth login` to sign in.');
        if (hasLoginForOtherConsole(deps)) {
            deps.reporter.info(
                `A login for another Vendure Console is stored in ${status.path}. ` +
                    'Check VENDURE_CONSOLE_API_URL, or sign in again to replace it.',
            );
        }
        return 1;
    }
    const lines = [`Logged in as ${describeLogin(status)}`];
    if (status.organization) {
        lines.push(`Organization: ${describeOrganization(status.organization)}`);
    }
    if (status.accessTokenExpiresAt !== undefined) {
        lines.push(
            `Access token expires: ${new Date(status.accessTokenExpiresAt).toISOString()} (renewed automatically)`,
        );
    }
    lines.push(
        `Vendure Console: ${status.consoleApiUrl}`,
        `WorkOS client: ${status.clientId ?? 'unknown'}`,
        `Stored in: ${status.path}`,
    );
    deps.reporter.info(lines.join('\n'));
    return 0;
}

export async function authLogoutCommand(
    dependencies: Partial<AuthCommandDependencies> = {},
): Promise<number> {
    const deps = resolveDependencies(dependencies);
    let result: LogoutResult;
    try {
        result = await logout(deps);
    } catch (error) {
        deps.reporter.error(error instanceof Error ? error.message : 'The logout failed.');
        return 1;
    }
    if (!result.removed) {
        deps.reporter.info('Not logged in.');
    } else if (result.sessionEnded) {
        deps.reporter.success('Logged out. The session was ended and the login removed from this machine.');
    } else {
        deps.reporter.success('Logged out. The login was removed from this machine.');
        deps.reporter.warn(
            'Vendure Console could not end the session, so a copy of this login keeps working until it expires.',
        );
    }
    return 0;
}

/** Reports a misconfigured Console API rather than throwing it. */
function hasValidEnvironment(deps: AuthCommandDependencies): boolean {
    try {
        resolveConsoleApiUrl(deps);
        return true;
    } catch (error) {
        deps.reporter.error(error instanceof Error ? error.message : String(error));
        return false;
    }
}

function describeOrganization(organization: StoredOrganization): string {
    const { name, customerAccountId, workosOrganizationId } = organization;
    if (name && customerAccountId) {
        return `${name} (Account identifier ${customerAccountId})`;
    }
    return workosOrganizationId;
}

function describeLogin(status: AuthStatus): string {
    const name = [status.user?.firstName, status.user?.lastName].filter(Boolean).join(' ');
    const email = status.user?.email ?? 'an unknown user';
    return name ? `${name} <${email}>` : email;
}
