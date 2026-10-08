import {
    NotLoggedInError,
    ReauthenticationRequiredError,
    SessionLockUnavailableError,
    SessionRejectedError,
} from './auth-errors';
import { AuthOptions, getAuthFilePath, getAuthLockPath, resolveConsoleApiUrl } from './auth-options';
import {
    AuthUser,
    StoredAuth,
    StoredOrganization,
    assertStorable,
    clearStoredAuth,
    readStoredAuth,
    readStoredAuthFile,
    writeStoredAuth,
} from './auth-store';
import {
    AuthOrganization,
    ConsoleTokenRefusedError,
    fetchOrganizations,
    fetchWorkosClient,
    resolveOrganization,
    signOut,
} from './console-api';
import { FileLockOptions, withFileLock } from './file-lock';
import {
    DeviceAuthorization,
    WORKOS_REQUEST_TIMEOUT_MS,
    WorkosAuthentication,
    WorkosClient,
    exchangeRefreshToken,
    pollDeviceAuthorization,
    startDeviceAuthorization,
} from './workos-client';

/**
 * The CLI login without its tokens: safe to print, log or return as JSON.
 *
 * @since 3.8.0
 */
export interface AuthStatus {
    loggedIn: boolean;
    /** The Vendure Console API the CLI signs in to. */
    consoleApiUrl: string;
    /** Where the login is stored. */
    path: string;
    /** The WorkOS client that issued the stored login, as Console published it at login. */
    clientId?: string;
    user?: AuthUser;
    /** The organization the session is scoped to. */
    organization?: StoredOrganization | null;
    /** When the current access token expires, as epoch milliseconds. It is renewed automatically. */
    accessTokenExpiresAt?: number;
}

/** What {@link logout} did. @since 3.8.0 */
export interface LogoutResult {
    /** Whether a login was stored on this machine. It is gone either way. */
    removed: boolean;
    /** Whether Vendure Console ended the WorkOS session, so copies of the login stop working too. */
    sessionEnded: boolean;
}

/** @since 3.8.0 */
export interface DeviceLoginOptions extends AuthOptions {
    /** Shows the user the code and URL to approve. Called once, before polling starts. */
    onDeviceAuthorization?: (device: DeviceAuthorization) => void | Promise<void>;
    /**
     * Scope the new session to this organization rather than the one chosen in
     * the browser: a Customer Account id (Console's "Account identifier") or
     * its name, ignoring case. Resolved through Vendure Console after sign-in.
     */
    organization?: string;
}

/**
 * A token this close to expiry is renewed before use. It covers a request that
 * is still in flight when the token runs out.
 */
const ACCESS_TOKEN_SKEW_MS = 60_000;

/**
 * `staleMs` covers the worst case of two refresh exchanges timing out (a
 * rotated-token retry spends a second one), so a waiter never breaks a lock
 * that is still doing useful work.
 *
 * `waitMs` must not be shorter. Waiting at least as long as `staleMs` means a
 * waiter breaks a dead holder's lock rather than giving up first, so
 * {@link SessionLockUnavailableError} is left for a lock that cannot be taken
 * at all, such as an unwritable config directory.
 */
export const SESSION_LOCK_OPTIONS: FileLockOptions = {
    staleMs: 2 * WORKOS_REQUEST_TIMEOUT_MS + 15_000,
    waitMs: 2 * WORKOS_REQUEST_TIMEOUT_MS + 15_000,
    onWait: () => {
        // stderr, so a command's JSON on stdout stays parseable.
        process.stderr.write('Waiting for another vendure command to finish renewing the CLI session...\n');
    },
};

/**
 * Serializes everything that spends the single-use refresh token or rewrites
 * `auth.json`, across processes. Every such call goes through here: guarding
 * only some of them leaves the double spend reachable through the others
 * (CLO-164). Without the lock nothing runs, because spending or rewriting
 * unlocked can strand or overwrite another process's login.
 */
function withSessionLock<T>(options: AuthOptions, fn: () => Promise<T>): Promise<T> {
    const lockFile = getAuthLockPath(options);
    return withFileLock(lockFile, SESSION_LOCK_OPTIONS, held => {
        if (!held) {
            throw new SessionLockUnavailableError(lockFile);
        }
        return fn();
    });
}

/**
 * Returns an access token for the stored CLI login, renewing it first when it is
 * about to expire. Returns `undefined` when this machine has no login.
 *
 * Send it as `Authorization: Bearer <token>`. If the server still answers 401,
 * call {@link refreshAccessToken} with the token that failed and retry once.
 *
 * @throws SessionRejectedError when the login has ended and needs the browser again.
 * @since 3.8.0
 */
export async function getAccessToken(options: AuthOptions = {}): Promise<string | undefined> {
    const stored = readStoredAuth(options);
    if (!stored) {
        return undefined;
    }
    if (hasUsableLifetime(stored.accessToken, options)) {
        return stored.accessToken;
    }
    return refreshAccessToken(stored.accessToken, options);
}

const activeRefreshes = new Map<string, Promise<string>>();

/**
 * Renews the stored session and returns the new access token.
 *
 * Pass the access token the server refused. When the stored login has already
 * moved on from it, because another command renewed it meanwhile, that newer
 * token is returned and no refresh token is spent: they are single-use, and a
 * redundant exchange is what strands a login.
 *
 * @throws NotLoggedInError when this machine has no login.
 * @throws SessionRejectedError when WorkOS refused the refresh token. The stored login is removed.
 * @throws SessionRefreshUnavailableError on a transient failure. The stored login is kept.
 * @throws ReauthenticationRequiredError when WorkOS needs a new sign-in. The stored login is kept.
 * @throws SessionLockUnavailableError when the login's lock cannot be taken. Nothing is spent.
 * @since 3.8.0
 */
export function refreshAccessToken(failedAccessToken: string, options: AuthOptions = {}): Promise<string> {
    const key = getAuthFilePath(options);
    const active = activeRefreshes.get(key);
    if (active) {
        return active;
    }
    const refresh = withSessionLock(options, () => refreshUnderLock(failedAccessToken, options)).finally(() =>
        activeRefreshes.delete(key),
    );
    activeRefreshes.set(key, refresh);
    return refresh;
}

async function refreshUnderLock(failedAccessToken: string, options: AuthOptions): Promise<string> {
    // Re-read: under the lock this is whatever the process ahead of us wrote.
    const stored = readStoredAuth(options);
    if (!stored) {
        throw new NotLoggedInError();
    }
    if (stored.accessToken !== failedAccessToken && hasUsableLifetime(stored.accessToken, options)) {
        return stored.accessToken;
    }
    const renewed = await spendRefreshToken(stored, options);
    return renewed.accessToken;
}

/**
 * Spends the stored refresh token and writes the new pair. The read, exchange
 * and write must run as one unit under the session lock.
 */
async function spendRefreshToken(stored: StoredAuth, options: AuthOptions): Promise<StoredAuth> {
    assertStorable(stored, options);
    // The login the new pair replaces. On the recovery path below it is the one
    // another process wrote, which may be scoped to a different organization.
    let base = stored;
    let authentication: WorkosAuthentication;
    try {
        authentication = await exchangeWithScope(base, options);
    } catch (error) {
        if (!(error instanceof SessionRejectedError)) {
            throw error;
        }
        // Spent, not necessarily revoked: a process whose lock was broken as
        // stale while it still worked may have used our refresh token and
        // stored a working pair.
        const rotated = readStoredAuth(options);
        if (!rotated || rotated.refreshToken === stored.refreshToken) {
            discardIfStillSpent(stored.refreshToken, options);
            throw error;
        }
        if (hasUsableLifetime(rotated.accessToken, options)) {
            return rotated;
        }
        assertStorable(rotated, options);
        base = rotated;
        authentication = await exchangeWithScope(base, options);
    }
    const next: StoredAuth = {
        ...base,
        accessToken: authentication.accessToken,
        refreshToken: authentication.refreshToken,
        user: authentication.user,
    };
    writeStoredAuth(next, options);
    return next;
}

/**
 * Renews for the login's own organization, so the token keeps its scope.
 * Without it WorkOS may pick another of the user's organizations.
 */
function exchangeWithScope(auth: StoredAuth, options: AuthOptions): Promise<WorkosAuthentication> {
    return exchangeRefreshToken(
        storedClient(auth),
        auth.refreshToken,
        auth.organization?.workosOrganizationId ?? null,
        options,
    );
}

/**
 * The only path that discards a login on a refusal. It runs under the session
 * lock, and the re-read keeps a pair another process wrote since the rejection.
 */
function discardIfStillSpent(spentRefreshToken: string, options: AuthOptions): void {
    const latest = readStoredAuth(options);
    if (latest?.refreshToken === spentRefreshToken) {
        clearStoredAuth(options);
    }
}

/**
 * Signs in with the WorkOS device flow and stores the session, replacing any
 * login already on this machine. The WorkOS client is the one the selected
 * Vendure Console publishes, so Console accepts the tokens.
 *
 * @throws SessionLockUnavailableError when the login's lock cannot be taken.
 * @since 3.8.0
 */
export async function loginWithDevice(options: DeviceLoginOptions = {}): Promise<AuthStatus> {
    const consoleApiUrl = resolveConsoleApiUrl(options);
    // Before the browser step, so a Console that cannot be reached fails before
    // the user approves anything.
    const client = await fetchWorkosClient(consoleApiUrl, options);
    const device = await startDeviceAuthorization(client, options);
    await options.onDeviceAuthorization?.(device);
    let authentication = await pollDeviceAuthorization(client, device, options);
    const toSession = (scope: StoredOrganization | null): StoredAuth => ({
        version: 1,
        consoleApiUrl,
        clientId: client.clientId,
        workosApiHostname: client.apiHostname,
        accessToken: authentication.accessToken,
        refreshToken: authentication.refreshToken,
        user: authentication.user,
        organization: scope,
    });
    let organization: StoredOrganization | null;
    if (options.organization) {
        const target = resolveOrganization(
            await fetchOrganizations(consoleApiUrl, authentication.accessToken, options),
            options.organization,
        );
        organization = toStoredOrganization(target);
        if (tokenOrganizationId(authentication) !== target.workosOrganizationId) {
            assertStorable(toSession(organization), options);
            // The browser chose another organization, or none. This refresh token
            // exists only in this process, so spending it needs no lock.
            authentication = await scopeToOrganization(client, authentication.refreshToken, target, options);
        }
        if (tokenOrganizationId(authentication) !== target.workosOrganizationId) {
            throw new Error(`WorkOS did not scope the login to ${target.name}.`);
        }
    } else {
        organization = await describeTokenOrganization(consoleApiUrl, authentication, options);
    }
    const session = toSession(organization);
    return withSessionLock(options, () => {
        writeStoredAuth(session, options);
        return Promise.resolve(readAuthStatus(options));
    });
}

/**
 * Scopes the stored login to one of the user's organizations without a new
 * sign-in in the browser. A first device login often has no organization, and
 * Console refuses such a login on account routes. Spends the refresh token
 * with the organization's id, as `loginWithDevice` does for `organization`.
 * WorkOS refuses an organization the user is not a member of.
 *
 * When WorkOS scopes the new pair to another organization, the pair is stored
 * anyway, because the old refresh token is spent. Only the token's own
 * organization is recorded with it.
 *
 * @throws NotLoggedInError when this machine has no login.
 * @throws SessionRejectedError when WorkOS refused the refresh token. The stored login is removed.
 * @throws SessionLockUnavailableError when the login's lock cannot be taken. Nothing is spent.
 */
export function scopeStoredLogin(
    organization: AuthOrganization,
    options: AuthOptions = {},
): Promise<AuthStatus> {
    return withSessionLock(options, async () => {
        const stored = readStoredAuth(options);
        if (!stored) {
            throw new NotLoggedInError();
        }
        const scoped: StoredAuth = { ...stored, organization: toStoredOrganization(organization) };
        assertStorable(scoped, options);
        let authentication: WorkosAuthentication;
        try {
            authentication = await scopeToOrganization(
                storedClient(stored),
                stored.refreshToken,
                organization,
                options,
            );
        } catch (error) {
            if (error instanceof SessionRejectedError) {
                discardIfStillSpent(stored.refreshToken, options);
            }
            throw error;
        }
        const matched = tokenOrganizationId(authentication) === organization.workosOrganizationId;
        const tokenOrganization = matched
            ? scoped.organization
            : await describeTokenOrganization(resolveConsoleApiUrl(options), authentication, options);
        writeStoredAuth(
            {
                ...scoped,
                accessToken: authentication.accessToken,
                refreshToken: authentication.refreshToken,
                user: authentication.user,
                organization: tokenOrganization,
            },
            options,
        );
        if (!matched) {
            const current = tokenOrganization
                ? `is now scoped to ${tokenOrganization.name ?? tokenOrganization.workosOrganizationId}`
                : 'has no organization';
            throw new Error(
                `WorkOS did not scope the login to ${organization.name}. The stored login ${current}. ` +
                    'Run vendure auth login --organization <Account identifier> to choose the account.',
            );
        }
        return readAuthStatus(options);
    });
}

/**
 * Spends `refreshToken` for a session scoped to `target`. WorkOS refuses an
 * organization the user is not a member of.
 */
async function scopeToOrganization(
    client: WorkosClient,
    refreshToken: string,
    target: AuthOrganization,
    options: AuthOptions,
): Promise<WorkosAuthentication> {
    try {
        return await exchangeRefreshToken(client, refreshToken, target.workosOrganizationId, options);
    } catch (error) {
        if (error instanceof ReauthenticationRequiredError) {
            throw new Error(
                `${target.name} requires a new sign-in through WorkOS (${error.code}). Run ` +
                    `\`vendure auth login\` without --organization and choose ${target.name} in the browser.`,
            );
        }
        throw error;
    }
}

/**
 * Names the organization the browser chose. Best effort: the login is complete
 * without it, so a Console that cannot be reached costs only the name.
 */
async function describeTokenOrganization(
    consoleApiUrl: string,
    authentication: WorkosAuthentication,
    options: AuthOptions,
): Promise<StoredOrganization | null> {
    const workosOrganizationId = tokenOrganizationId(authentication);
    if (!workosOrganizationId) {
        return null;
    }
    const known = await fetchOrganizations(consoleApiUrl, authentication.accessToken, options)
        .then(organizations => organizations.find(org => org.workosOrganizationId === workosOrganizationId))
        .catch(() => undefined);
    return known
        ? toStoredOrganization(known)
        : { workosOrganizationId, customerAccountId: null, name: null };
}

/**
 * Lists the Vendure Console organizations the signed-in user is an active member
 * of. Sends the stored login's access token to Vendure Console only.
 *
 * @throws NotLoggedInError when this machine has no login.
 * @since 3.8.0
 */
export async function listOrganizations(options: AuthOptions = {}): Promise<AuthOrganization[]> {
    const consoleApiUrl = resolveConsoleApiUrl(options);
    const token = await getAccessToken(options);
    if (!token) {
        throw new NotLoggedInError();
    }
    try {
        return await fetchOrganizations(consoleApiUrl, token, options);
    } catch (error) {
        if (!(error instanceof ConsoleTokenRefusedError)) {
            throw error;
        }
        return fetchOrganizations(consoleApiUrl, await refreshAccessToken(token, options), options);
    }
}

function toStoredOrganization(organization: AuthOrganization): StoredOrganization {
    return {
        workosOrganizationId: organization.workosOrganizationId,
        customerAccountId: organization.customerAccountId,
        name: organization.name,
    };
}

function tokenOrganizationId(authentication: WorkosAuthentication): string | null {
    return authentication.organizationId ?? readJwtClaim(authentication.accessToken, 'org_id');
}

/**
 * Signs out: asks Vendure Console to end the WorkOS session, then removes the
 * login from this machine. Ending the session is best effort. When Console
 * cannot be reached, a copy of the refresh token keeps working until it
 * expires, and `sessionEnded` is `false`.
 *
 * @throws SessionLockUnavailableError when the login's lock cannot be taken.
 * @since 3.8.0
 */
export async function logout(options: AuthOptions = {}): Promise<LogoutResult> {
    const stored = readStoredAuthFile(options);
    if (!stored) {
        return { removed: false, sessionEnded: false };
    }
    const sessionEnded = await endSession(stored, options);
    // Locked, so a refresh in flight cannot write the login back afterwards.
    await withSessionLock(options, () => {
        clearStoredAuth(options);
        return Promise.resolve();
    });
    return { removed: true, sessionEnded };
}

/**
 * Console signs out only a valid access token. A login for the selected
 * Console is renewed first if needed. A login for another Console is signed
 * out with its stored token while that token is still valid.
 */
async function endSession(stored: StoredAuth, options: AuthOptions): Promise<boolean> {
    try {
        let token: string | undefined;
        if (readStoredAuth(options)) {
            token = await getAccessToken(options);
        } else if (hasUsableLifetime(stored.accessToken, options)) {
            token = stored.accessToken;
        }
        return token ? await signOut(stored.consoleApiUrl, token, options) : false;
    } catch {
        return false;
    }
}

/**
 * Describes the stored login without exposing its tokens. Makes no request.
 *
 * @since 3.8.0
 */
export function readAuthStatus(options: AuthOptions = {}): AuthStatus {
    const status: AuthStatus = {
        loggedIn: false,
        consoleApiUrl: resolveConsoleApiUrl(options),
        path: getAuthFilePath(options),
    };
    const stored = readStoredAuth(options);
    if (!stored) {
        return status;
    }
    const expiresAt = readJwtExpiryMs(stored.accessToken);
    return {
        ...status,
        loggedIn: true,
        clientId: stored.clientId,
        user: stored.user,
        organization: stored.organization,
        ...(expiresAt === undefined ? {} : { accessTokenExpiresAt: expiresAt }),
    };
}

/** Whether a login for a different Vendure Console is on disk. */
export function hasLoginForOtherConsole(options: AuthOptions = {}): boolean {
    const stored = readStoredAuthFile(options);
    return stored !== undefined && stored.consoleApiUrl !== resolveConsoleApiUrl(options);
}

function storedClient(auth: StoredAuth): WorkosClient {
    return { clientId: auth.clientId, apiHostname: auth.workosApiHostname };
}

/**
 * Fails toward renewing: a token without a readable `exp` is not provably
 * valid, and an unnecessary renewal costs only a round trip.
 */
function hasUsableLifetime(accessToken: string, options: AuthOptions): boolean {
    const expiresAt = readJwtExpiryMs(accessToken);
    return expiresAt !== undefined && expiresAt - (options.now ?? Date.now)() > ACCESS_TOKEN_SKEW_MS;
}

function readJwtExpiryMs(token: string): number | undefined {
    const exp = readJwtClaim(token, 'exp');
    return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : undefined;
}

/** Reads a claim without verifying the signature. The servers verify; this only schedules renewal. */
function readJwtClaim(token: string, claim: 'exp'): unknown;
function readJwtClaim(token: string, claim: 'org_id'): string | null;
function readJwtClaim(token: string, claim: string): unknown {
    const payload = token.split('.')[1];
    let value: unknown;
    try {
        const decoded: unknown = payload
            ? JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'))
            : undefined;
        value =
            decoded && typeof decoded === 'object' ? (decoded as Record<string, unknown>)[claim] : undefined;
    } catch {
        value = undefined;
    }
    if (claim === 'org_id') {
        return typeof value === 'string' && value.length > 0 ? value : null;
    }
    return value;
}
