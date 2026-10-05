export const AUTH_LOGIN_COMMAND = 'vendure auth login';

/**
 * No CLI login is stored on this machine for the configured WorkOS client.
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
 * The session could not be renewed for a reason that may pass: the network, a
 * timeout, a WorkOS outage. The stored login is kept, so retrying is safe.
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
