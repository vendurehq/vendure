export const AUTH_LOGIN_COMMAND = 'vendure auth login';

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
 * WorkOS refused the stored refresh token (`invalid_grant`): it was revoked,
 * expired or already spent. The login cannot be renewed without the browser.
 *
 * @since 3.8.0
 */
export class SessionRejectedError extends Error {
    readonly nextStep = AUTH_LOGIN_COMMAND;

    constructor(message = `Your CLI session has ended. Run \`${AUTH_LOGIN_COMMAND}\` to sign in again.`) {
        super(message);
        this.name = 'SessionRejectedError';
    }
}

/**
 * The session could not be renewed, usually for a reason that may pass: the
 * network, a timeout, a WorkOS outage. The stored login is kept. The message
 * says when the refresh token was already spent and a retry will not help.
 *
 * @since 3.8.0
 */
export class SessionRefreshUnavailableError extends Error {
    constructor(message = 'Could not reach the authentication service to renew your CLI session.') {
        super(message);
        this.name = 'SessionRefreshUnavailableError';
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
 * WorkOS needs a new interactive sign-in before it renews the session, for
 * example because the organization now enforces SSO or MFA. `code` is the
 * WorkOS error code, such as `sso_required` or `mfa_enrollment`.
 *
 * @since 3.8.0
 */
export class ReauthenticationRequiredError extends Error {
    readonly nextStep = AUTH_LOGIN_COMMAND;

    constructor(readonly code: string) {
        super(`WorkOS requires you to sign in again (${code}). Run \`${AUTH_LOGIN_COMMAND}\`.`);
        this.name = 'ReauthenticationRequiredError';
    }
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
