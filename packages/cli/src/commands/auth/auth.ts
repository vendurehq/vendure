import { CommandContext, ErrorResult, fail } from '@vendure/common/lib/command';

import { DeviceLoginDeniedError, DeviceLoginExpiredError } from '../../auth/auth-errors.js';
import { AuthOptions, resolveConsoleApiUrl } from '../../auth/auth-options.js';
import { AuthStatus, RenewalError } from '../../auth/auth-session.js';
import { StoredOrganization } from '../../auth/auth-store.js';
import { AuthOrganization } from '../../auth/console-api.js';
import { NoPendingLoginError } from '../../auth/pending-login.js';
import { TOKEN_TOO_BIG, TOKEN_TOO_BIG_ADVICE } from '../../auth/workos-client.js';
import { hostErrors } from '../../command-host/host-errors.js';

import { authErrors } from './auth.errors.js';
import { LoggedInOutput } from './auth.schema.js';

export const ORGANIZATION_LOGIN_COMMAND = 'vendure auth login --organization <Account identifier or name>';

/** Seams for the `vendure auth` commands. Every field defaults to the real process. */
export interface AuthCommandDependencies extends AuthOptions {
    openUrl?: (url: string) => Promise<void>;
}

/** The organization prompt was cancelled. */
export class LoginCancelledError extends Error {
    constructor() {
        super('Login cancelled.');
        this.name = 'LoginCancelledError';
    }
}

/** A misconfigured `VENDURE_CONSOLE_API_URL` as a coded error, or `undefined` when it is valid. */
export function invalidConsoleApi(options: AuthOptions): ErrorResult | undefined {
    try {
        resolveConsoleApiUrl(options);
        return undefined;
    } catch (error) {
        return fail(authErrors.consoleApiInvalid, { message: errorMessage(error) });
    }
}

/** A failed login as the coded error that says what to do next. */
export function loginError(error: unknown): ErrorResult {
    if (error instanceof LoginCancelledError) {
        return fail(hostErrors.cancelled, {});
    }
    if (error instanceof DeviceLoginDeniedError) {
        return fail(authErrors.loginDenied, {});
    }
    if (error instanceof DeviceLoginExpiredError) {
        return fail(authErrors.loginExpired, {});
    }
    if (error instanceof NoPendingLoginError) {
        return fail(authErrors.noPendingLogin, { reason: error.reason });
    }
    return fail(authErrors.loginFailed, { message: errorMessage(error, 'The login failed.') });
}

/**
 * Chooses the organization after sign-in when the user has more than one. A person is asked,
 * with the browser's choice first so Enter keeps it. Without one, the browser's choice stands
 * and a notice says how to pick another.
 */
export function organizationChooser(ctx: CommandContext, onKept: () => void) {
    return async (
        organizations: AuthOrganization[],
        current: AuthOrganization | undefined,
    ): Promise<AuthOrganization | undefined> => {
        if (!ctx.ask) {
            onKept();
            return undefined;
        }
        const isCurrent = (org: AuthOrganization) =>
            org.workosOrganizationId === current?.workosOrganizationId;
        const ordered = [...organizations.filter(isCurrent), ...organizations.filter(org => !isCurrent(org))];
        const chosen = await ctx.ask.select(
            'Which Vendure Console account do you want to use?',
            ordered.map(org => ({
                value: org.workosOrganizationId,
                label: `${org.name} (${org.customerAccountId})`,
            })),
        );
        const organization = ordered.find(org => org.workosOrganizationId === chosen);
        if (!organization) {
            throw new LoginCancelledError();
        }
        return organization;
    };
}

/** The notice for a login that kept the browser's organization because nobody could be asked. */
export function keptBrowserChoiceNotice(status: AuthStatus): string {
    const used = status.organization ? describeOrganization(status.organization) : 'none of them';
    return (
        `You belong to more than one organization, and this login uses ${used}. ` +
        `To use another, run \`${ORGANIZATION_LOGIN_COMMAND}\`.`
    );
}

export function toLoggedIn(status: AuthStatus): LoggedInOutput {
    return {
        loggedIn: true,
        consoleApiUrl: status.consoleApiUrl,
        user: status.user ?? { id: '', email: '', firstName: null, lastName: null },
        organization: status.organization ?? null,
    };
}

export function describeLoggedIn(output: LoggedInOutput): string {
    const scope = output.organization ? ` to ${describeOrganization(output.organization)}` : '';
    return `Logged in as ${describeUser(output.user)}${scope}.`;
}

export function describeOrganization(organization: StoredOrganization): string {
    const { name, customerAccountId, workosOrganizationId } = organization;
    if (name && customerAccountId) {
        return `${name} (Account identifier ${customerAccountId})`;
    }
    return workosOrganizationId;
}

export function describeLogin(status: Pick<AuthStatus, 'user'>): string {
    return describeUser(status.user);
}

function describeUser(user: AuthStatus['user']): string {
    const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ');
    const email = user?.email || 'an unknown user';
    return name ? `${name} <${email}>` : email;
}

export function describeEmail(status: Pick<AuthStatus, 'user'>): string {
    return status.user?.email ?? 'an unknown user';
}

export function describeRefusal(status: AuthStatus, nextStep: string): string {
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

export function errorMessage(error: unknown, fallback?: string): string {
    if (error instanceof Error) {
        return error.message;
    }
    return fallback ?? String(error);
}
