import {
    CommandCredential,
    CommandFix,
    IncompleteResult,
    InputNeed,
    incomplete,
} from '@vendure/common/lib/command';

import { NotLoggedInError, isRenewalRefused } from './auth-errors.js';
import { AuthOptions } from './auth-options.js';
import { getAccessToken, readAuthStatus } from './auth-session.js';
import { StoredOrganization } from './auth-store.js';

/** The environment variable that holds a Vendure Cloud credential, such as a delegated agent key. */
export const CLOUD_TOKEN_ENV = 'VENDURE_CLOUD_TOKEN';

/**
 * The fix for a missing credential. Under `--json` it returns the login code at once, so a
 * caller can hand it to a person and finish with `vendure auth wait`.
 *
 * @since 4.0.0
 */
export const LOGIN_FIX: CommandFix = {
    path: ['auth', 'login'],
    input: { json: true },
    description: 'Start a login, and give the person the URL and code it returns',
};

/**
 * Where the credential in use comes from: the login stored by `vendure auth login`, or the
 * `VENDURE_CLOUD_TOKEN` environment variable.
 *
 * @since 4.0.0
 */
export type CredentialSource = CommandCredential['source'];

/**
 * The credential a command sends to Vendure Cloud or Vendure Console. The host hands it to a
 * `requires.auth` command as `ctx.credential`. `token` is a bearer token: never print, log or
 * return it.
 *
 * @since 4.0.0
 */
export type CloudCredential = CommandCredential;

/** @since 4.0.0 */
export interface RequireCredentialOptions extends AuthOptions {
    /**
     * Whether a person may be asked, which is the host's decision: both stdin and stdout are TTYs,
     * no `--json`, and neither `CI` nor `VENDURE_CLI_NON_INTERACTIVE` is set. Only then may
     * `signIn` run.
     */
    mayPrompt: boolean;
    /**
     * Use the stored login only when it is scoped to this organization: an Account identifier or
     * a name, ignoring case.
     */
    organization?: string;
    /** Signs a person in with the device flow and stores the login. Called only when `mayPrompt`. */
    signIn?: () => Promise<void>;
}

/**
 * The `input` need for a missing credential: the secret `token` field, whose fix is
 * `vendure auth login --json`. A caller that cannot sign in a person can instead set
 * `VENDURE_CLOUD_TOKEN`.
 *
 * @since 4.0.0
 */
export function credentialNeed(): InputNeed {
    return {
        kind: 'input',
        field: 'token',
        description:
            `A Vendure Cloud credential: sign in with \`vendure auth login\`, or set ${CLOUD_TOKEN_ENV} ` +
            'to a delegated agent key',
        secret: true,
        fix: LOGIN_FIX,
    };
}

/**
 * Finds the credential a command needs, in this order:
 *
 * 1. The stored login, when there is one and it can be renewed.
 * 2. `VENDURE_CLOUD_TOKEN`, when it is set.
 * 3. A device login, only when a person may be asked (`mayPrompt`).
 * 4. Otherwise an `incomplete` result with {@link credentialNeed}.
 *
 * Without a person, step 3 never runs, so no command starts a device flow under `--json`, `CI`,
 * `VENDURE_CLI_NON_INTERACTIVE` or without a TTY.
 *
 * @throws SessionRefreshUnavailableError when the stored login could not be renewed for a transient reason. It is kept.
 * @since 4.0.0
 */
export async function requireCredential(
    options: RequireCredentialOptions,
): Promise<CloudCredential | IncompleteResult> {
    const { credential } = await findCredential(options);
    if (credential) {
        return credential;
    }
    if (options.mayPrompt && options.signIn) {
        await options.signIn();
        const token = await getAccessToken(options);
        if (!token) {
            throw new NotLoggedInError();
        }
        return { source: 'stored-login', token };
    }
    return incomplete([credentialNeed()]);
}

/** The value of `VENDURE_CLOUD_TOKEN`, or `undefined` when it is unset or blank. */
export function readCloudTokenEnv(options: AuthOptions = {}): string | undefined {
    const value = (options.env ?? process.env)[CLOUD_TOKEN_ENV]?.trim();
    return value ? value : undefined;
}

/** @since 4.0.0 */
export interface FindCredentialOptions extends AuthOptions {
    /** Use the stored login only when it is scoped to this organization. */
    organization?: string;
    /** Leave out `VENDURE_CLOUD_TOKEN`, for a step that needs a person's own login. */
    personOnly?: boolean;
}

/**
 * The credential that needs no sign-in, by the rule of {@link requireCredential}: the stored
 * login when it can be renewed, else `VENDURE_CLOUD_TOKEN`. `refusal` says why a stored login
 * could not be used, when the authentication service refused to renew it.
 *
 * @throws SessionRefreshUnavailableError when the stored login could not be renewed for a transient reason. It is kept.
 * @since 4.0.0
 */
export async function findCredential(
    options: FindCredentialOptions,
): Promise<{ credential?: CloudCredential; refusal?: Error }> {
    const { token, refusal } = await storedLoginToken(options);
    if (token) {
        return { credential: { source: 'stored-login', token } };
    }
    const environmentToken = options.personOnly ? undefined : readCloudTokenEnv(options);
    if (environmentToken) {
        return { credential: { source: 'environment', token: environmentToken } };
    }
    return refusal ? { refusal } : {};
}

/**
 * The access token of the stored login, renewed when needed. None when there is no login, or it
 * is scoped to another organization. `refusal` when the authentication service refused to renew it.
 */
async function storedLoginToken(
    options: FindCredentialOptions,
): Promise<{ token?: string; refusal?: Error }> {
    const status = readAuthStatus(options);
    if (!status.loggedIn) {
        return {};
    }
    if (options.organization && !matchesOrganization(status.organization, options.organization)) {
        return {};
    }
    try {
        const token = await getAccessToken(options);
        return token ? { token } : {};
    } catch (error) {
        if (error instanceof NotLoggedInError) {
            // Another command removed the login meanwhile.
            return {};
        }
        if (error instanceof Error && isRenewalRefused(error)) {
            return { refusal: error };
        }
        throw error;
    }
}

/** Matches `--organization` the way `vendure auth login` resolves it: an Account identifier or a name. */
export function matchesOrganization(
    organization: StoredOrganization | null | undefined,
    wanted: string,
): boolean {
    const value = wanted.trim().toLowerCase();
    return (
        organization?.customerAccountId?.toLowerCase() === value ||
        organization?.name?.trim().toLowerCase() === value
    );
}
