export const AUTH_LOGIN_COMMAND = 'vendure auth login';

/**
 * What the authentication service answered when it did not renew the session.
 * `code` is its error code, such as `invalid_grant`. `status` is the HTTP
 * status. Both are absent when no answer arrived.
 *
 * @since 3.8.2
 */
export interface RenewalFailureDetails {
    code?: string;
    status?: number;
}

/**
 * No CLI login is stored on this machine for the selected Vendure Console.
 *
 * @since 3.8.0
 */
export class NotLoggedInError extends Error {
    readonly nextStep = AUTH_LOGIN_COMMAND;

    constructor(message = `Not logged in. Run \`${AUTH_LOGIN_COMMAND}\` to sign in.`) {
        super(message);
        this.name = 'NotLoggedInError';
    }
}

/**
 * The authentication service refused the stored refresh token (`invalid_grant`):
 * it was revoked, expired or already spent. The login cannot be renewed without
 * the browser.
 *
 * @since 3.8.0
 */
export class SessionRejectedError extends Error {
    readonly nextStep = AUTH_LOGIN_COMMAND;
    /** @since 3.8.2 */
    readonly code?: string;
    /** @since 3.8.2 */
    readonly status?: number;

    constructor(
        message = `Your CLI session has ended. Run \`${AUTH_LOGIN_COMMAND}\` to sign in again.`,
        details: RenewalFailureDetails = {},
    ) {
        super(message);
        this.name = 'SessionRejectedError';
        this.code = details.code;
        this.status = details.status;
    }
}

/**
 * The session could not be renewed, usually for a reason that may pass: the
 * network, a timeout, an outage of the authentication service. The stored login
 * is kept. The message says when the refresh token was already spent and a
 * retry will not help. `code` and `status` are set when the service answered.
 *
 * @since 3.8.0
 */
export class SessionRefreshUnavailableError extends Error {
    /** @since 3.8.2 */
    readonly code?: string;
    /** @since 3.8.2 */
    readonly status?: number;

    constructor(
        message = 'Could not reach the authentication service to renew your CLI session.',
        details: RenewalFailureDetails = {},
    ) {
        super(message);
        this.name = 'SessionRefreshUnavailableError';
        this.code = details.code;
        this.status = details.status;
    }
}

/**
 * The renewed session could not be written, so the single-use refresh token was
 * not spent (CLO-703).
 *
 * @since 3.8.0
 */
export class SessionUnstorableError extends Error {
    constructor(directory: string) {
        super(`Cannot write the CLI session to ${directory}. Check that the directory is writable.`);
        this.name = 'SessionUnstorableError';
    }
}

/**
 * The authentication service needs a new interactive sign-in before it renews
 * the session, for example because the organization now enforces SSO or MFA.
 * `code` is its error code, such as `sso_required` or `mfa_enrollment`.
 *
 * @since 3.8.0
 */
export class ReauthenticationRequiredError extends Error {
    readonly nextStep = AUTH_LOGIN_COMMAND;

    constructor(
        readonly code: string,
        /** @since 3.8.2 */
        readonly status?: number,
    ) {
        super(
            `The authentication service requires you to sign in again (${code}). ` +
                `Run \`${AUTH_LOGIN_COMMAND}\`.`,
        );
        this.name = 'ReauthenticationRequiredError';
    }
}

/**
 * Whether a renewal failure means the stored login can no longer be renewed as
 * it is. A failure that may pass, such as no answer, a timeout, rate limiting
 * or a server error, is not a refusal. Neither is a 4xx answer without an
 * error code, which may come from a proxy rather than the authentication
 * service.
 *
 * Every other 4xx answer with an error code is final, including
 * `invalid_client`. A rotated or misconfigured client cannot renew the stored
 * login, and a new `vendure auth login` stores the current client with the
 * new login. The stored login is kept, so a wrong guess costs a sign-in.
 *
 * @since 3.8.2
 */
export function isRenewalRefused(error: unknown): boolean {
    if (error instanceof SessionRejectedError || error instanceof ReauthenticationRequiredError) {
        return true;
    }
    if (
        error instanceof SessionRefreshUnavailableError &&
        error.code !== undefined &&
        error.status !== undefined
    ) {
        return error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429;
    }
    return false;
}

/**
 * The CLI login's lock could not be taken: another `vendure` command held it
 * for the whole wait, or the config directory is not writable. A command that
 * spends the refresh token or rewrites the login does not run without it.
 *
 * @since 3.8.0
 */
export class SessionLockUnavailableError extends Error {
    constructor(lockFile: string) {
        super(
            `Could not lock the CLI login at ${lockFile}. Another vendure command may still be using it, ` +
                'or the directory is not writable. Try again. If no other vendure command is running, ' +
                'check that the directory is writable and delete the lock file.',
        );
        this.name = 'SessionLockUnavailableError';
    }
}
