import { confirm, isCancel, log, select } from '@clack/prompts';

import {
    AuthStatus,
    DeviceLoginOptions,
    LogoutResult,
    RenewalError,
    checkAuthStatus,
    loginWithDevice,
    logout,
    readAuthStatus,
} from '../../auth';
import { AuthOptions, resolveConsoleApiUrl } from '../../auth/auth-options';
import { hasLoginForOtherConsole } from '../../auth/auth-session';
import { StoredOrganization } from '../../auth/auth-store';
import { AuthOrganization } from '../../auth/console-api';
import { TOKEN_TOO_BIG, TOKEN_TOO_BIG_ADVICE } from '../../auth/workos-client';
import { isNonInteractiveEnvironment, withInteractiveTimeout } from '../../utilities/utils';
import { openConsoleBrowser } from '../console/authentication';

const ORGANIZATION_LOGIN_COMMAND = 'vendure auth login --organization <Account identifier or name>';

/** The organization prompt was cancelled, as the replace-login prompt can be. */
class LoginCancelledError extends Error {
    constructor() {
        super('Login cancelled.');
        this.name = 'LoginCancelledError';
    }
}

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
    /** Resolves `undefined` when the prompt was cancelled. */
    selectOrganization(
        organizations: AuthOrganization[],
        current: AuthOrganization | undefined,
    ): Promise<AuthOrganization | undefined>;
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
        selectOrganization: async (organizations, current) => {
            // Worded and ordered as `vendure console link` asks: the browser's choice first, so Enter keeps it.
            const isCurrent = (org: AuthOrganization) =>
                org.workosOrganizationId === current?.workosOrganizationId;
            const ordered = [
                ...organizations.filter(isCurrent),
                ...organizations.filter(org => !isCurrent(org)),
            ];
            const result = await withInteractiveTimeout(
                () =>
                    select({
                        message: 'Which Vendure Console account do you want to use?',
                        options: ordered.map(org => ({
                            value: org.workosOrganizationId,
                            label: `${org.name} (${org.customerAccountId})`,
                        })),
                    }),
                {
                    examples: [ORGANIZATION_LOGIN_COMMAND],
                    helpCommands: ['vendure auth login --help'],
                },
            );
            return isCancel(result) ? undefined : ordered.find(org => org.workosOrganizationId === result);
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
    if (!(await confirmReplacingStoredLogin(deps))) {
        deps.reporter.info('Login cancelled.');
        return 0;
    }

    // Without a terminal the browser's choice stands, and the result says how to pick another.
    let keptBrowserChoice = false;
    const abortController = new AbortController();
    const onSignal = () => abortController.abort();
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
    const loginOptions: DeviceLoginOptions = {
        ...deps,
        signal: abortController.signal,
        organization,
        chooseOrganization: async (organizations, current) => {
            if (deps.isNonInteractive()) {
                keptBrowserChoice = true;
                return undefined;
            }
            const chosen = await deps.selectOrganization(organizations, current);
            if (!chosen) {
                throw new LoginCancelledError();
            }
            return chosen;
        },
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
        if (keptBrowserChoice) {
            const used = status.organization ? describeOrganization(status.organization) : 'none of them';
            deps.reporter.info(
                `You belong to more than one organization, and this login uses ${used}. ` +
                    `To use another, run \`${ORGANIZATION_LOGIN_COMMAND}\`.`,
            );
        }
        return 0;
    } catch (error) {
        if (error instanceof LoginCancelledError) {
            deps.reporter.info('Login cancelled. Nothing was stored.');
            return 0;
        }
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

/**
 * Renews the stored login to check it, so a login the authentication service
 * no longer renews is reported instead of shown as logged in.
 */
export async function authStatusCommand(
    options: { json?: boolean } = {},
    dependencies: Partial<AuthCommandDependencies> = {},
): Promise<number> {
    const deps = resolveDependencies(dependencies);
    if (!hasValidEnvironment(deps)) {
        return 1;
    }
    const status = await checkAuthStatus(deps);
    if (options.json) {
        deps.writeStdout(`${JSON.stringify(status)}\n`);
        return status.loggedIn ? 0 : 1;
    }
    if (status.renewable === false) {
        deps.reporter.warn(describeRefusal(status, 'Run `vendure auth login` to sign in again.'));
        return 1;
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
    deps.reporter.info(lines.join('\n'));
    if (status.renewalError) {
        deps.reporter.warn(`Could not check that the login can be renewed: ${status.renewalError.message}`);
    }
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

/**
 * Checks a stored login before the sign-in replaces it. A login that can still
 * be renewed is replaced only when the user confirms. Resolves `false` when the
 * user keeps it.
 */
async function confirmReplacingStoredLogin(deps: AuthCommandDependencies): Promise<boolean> {
    // Without a terminal the login is replaced without asking, so there is nothing to check.
    if (deps.isNonInteractive() || !readAuthStatus(deps).loggedIn) {
        return true;
    }
    const existing = await checkAuthStatus(deps);
    if (existing.renewable === false) {
        deps.reporter.warn(describeRefusal(existing, 'Signing in again.'));
        return true;
    }
    if (!existing.loggedIn) {
        return true;
    }
    if (existing.renewalError) {
        deps.reporter.warn(
            `Could not check that the stored login can be renewed: ${existing.renewalError.message}`,
        );
    }
    const replace = await deps.confirm(`Already logged in as ${describeEmail(existing)}. Sign in again?`);
    return replace === true;
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
    const email = describeEmail(status);
    return name ? `${name} <${email}>` : email;
}

function describeEmail(status: AuthStatus): string {
    return status.user?.email ?? 'an unknown user';
}

function describeRefusal(status: AuthStatus, nextStep: string): string {
    const error = status.renewalError;
    const advice = error?.code === TOKEN_TOO_BIG ? ` ${TOKEN_TOO_BIG_ADVICE}` : '';
    return (
        `The stored login for ${describeEmail(status)} can no longer be renewed` +
        `${describeAnswer(error)}.${advice} ${nextStep}`
    );
}

/** The authentication service's answer, such as ` (invalid_grant, HTTP 400)`, or nothing without one. */
function describeAnswer(error: RenewalError | undefined): string {
    const parts = [error?.code, error?.status === undefined ? undefined : `HTTP ${error.status}`].filter(
        Boolean,
    );
    return parts.length ? ` (${parts.join(', ')})` : '';
}
