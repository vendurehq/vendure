import { NotLoggedInError, SessionRejectedError } from './auth-errors';
import { AuthOptions, getAuthFilePath, getAuthLockPath, resolveClientId } from './auth-options';
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
    resolveOrganization,
} from './console-organizations';
import { FileLockOptions, withFileLock } from './file-lock';
import {
    DeviceAuthorization,
    WORKOS_REQUEST_TIMEOUT_MS,
    WorkosAuthentication,
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
    /** The WorkOS client the CLI is configured for. */
    clientId: string;
    /** Where the login is stored. */
    path: string;
    user?: AuthUser;
    /** The organization the session is scoped to. */
    organization?: StoredOrganization | null;
    /** When the current access token expires, as epoch milliseconds. It is renewed automatically. */
    accessTokenExpiresAt?: number;
}

/** @since 3.8.0 */
export interface DeviceLoginOptions extends AuthOptions {
    /** Shows the user the code and URL to approve. Called once, before polling starts. */
    onDeviceAuthorization?: (device: DeviceAuthorization) => void | Promise<void>;
    /**
     * Scope the new session to this organization rather than the one chosen in
     * the browser: a Customer Account id (Console's "Account identifier") or
     * its exact name. Resolved through Vendure Console after sign-in.
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
 * `waitMs` must not be shorter. A waiter that gives up early runs unlocked
 * before the holder has written its rotated pair, sees the old token and spends
 * it a second time: the double spend this lock exists to prevent (CLO-164).
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
 * only some of them leaves the double spend reachable through the others.
 */
function withSessionLock<T>(options: AuthOptions, fn: (held: boolean) => Promise<T>): Promise<T> {
    return withFileLock(getAuthLockPath(options), SESSION_LOCK_OPTIONS, fn);
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
 * @since 3.8.0
 */
export function refreshAccessToken(failedAccessToken: string, options: AuthOptions = {}): Promise<string> {
    const key = getAuthFilePath(options);
    const active = activeRefreshes.get(key);
    if (active) {
        return active;
    }
    const refresh = withSessionLock(options, held =>
        refreshUnderLock(failedAccessToken, held, options),
    ).finally(() => activeRefreshes.delete(key));
    activeRefreshes.set(key, refresh);
    return refresh;
}

async function refreshUnderLock(
    failedAccessToken: string,
    held: boolean,
    options: AuthOptions,
): Promise<string> {
    // Re-read: under the lock this is whatever the process ahead of us wrote.
    const stored = readStoredAuth(options);
    if (!stored) {
        throw new NotLoggedInError();
    }
    if (stored.accessToken !== failedAccessToken && hasUsableLifetime(stored.accessToken, options)) {
        return stored.accessToken;
    }
    const renewed = await spendRefreshToken(stored, held, options);
    return renewed.accessToken;
}

/**
 * Spends the stored refresh token and writes the new pair. The read, exchange
 * and write must run as one unit under the session lock.
 */
async function spendRefreshToken(
    stored: StoredAuth,
    held: boolean,
    options: AuthOptions,
): Promise<StoredAuth> {
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
        // Spent, not necessarily revoked: a process that raced past the lock
        // may have used our refresh token and stored a working pair.
        const rotated = readStoredAuth(options);
        if (!rotated || rotated.refreshToken === stored.refreshToken) {
            discardIfStillSpent(stored.refreshToken, held, options);
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
        auth.clientId,
        auth.refreshToken,
        auth.organization?.workosOrganizationId ?? null,
        options,
    );
}

/**
 * The only path that discards a login on a refusal, so both guards matter.
 *
 * Without the lock we may have raced past a process that legitimately spent
 * the token, and `invalid_grant` then means "dead" and "someone beat me to it"
 * equally. The re-read keeps a pair the winner wrote since the rejection.
 */
function discardIfStillSpent(spentRefreshToken: string, held: boolean, options: AuthOptions): void {
    if (!held) {
        return;
    }
    const latest = readStoredAuth(options);
    if (latest?.refreshToken === spentRefreshToken) {
        clearStoredAuth(options);
    }
}

/**
 * Signs in with the WorkOS device flow and stores the session, replacing any
 * login already on this machine.
 *
 * @since 3.8.0
 */
export async function loginWithDevice(options: DeviceLoginOptions = {}): Promise<AuthStatus> {
    // Resolving the client also validates the Console API, so a misconfigured
    // environment fails before the browser approval, not after it.
    const clientId = resolveClientId(options);
    const device = await startDeviceAuthorization(clientId, options);
    await options.onDeviceAuthorization?.(device);
    let authentication = await pollDeviceAuthorization(clientId, device, options);
    let organization: StoredOrganization | null;
    if (options.organization) {
        const target = resolveOrganization(
            await fetchOrganizations(authentication.accessToken, options),
            options.organization,
        );
        if (tokenOrganizationId(authentication) !== target.workosOrganizationId) {
            assertStorable(
                {
                    version: 1,
                    clientId,
                    accessToken: authentication.accessToken,
                    refreshToken: authentication.refreshToken,
                    user: authentication.user,
                    organization: toStoredOrganization(target),
                },
                options,
            );
            // The browser chose another organization, or none. This refresh
            // token exists only in this process, so spending it needs no lock.
            // WorkOS refuses an organization the user is not a member of.
            authentication = await exchangeRefreshToken(
                clientId,
                authentication.refreshToken,
                target.workosOrganizationId,
                options,
            );
        }
        if (tokenOrganizationId(authentication) !== target.workosOrganizationId) {
            throw new Error(`WorkOS did not scope the login to ${target.name}.`);
        }
        organization = toStoredOrganization(target);
    } else {
        organization = await describeTokenOrganization(authentication, options);
    }
    const session: StoredAuth = {
        version: 1,
        clientId,
        accessToken: authentication.accessToken,
        refreshToken: authentication.refreshToken,
        user: authentication.user,
        organization,
    };
    return withSessionLock(options, () => {
        writeStoredAuth(session, options);
        return Promise.resolve(readAuthStatus(options));
    });
}

/**
 * Names the organization the browser chose. Best effort: the login is complete
 * without it, so a Console that cannot be reached costs only the name.
 */
async function describeTokenOrganization(
    authentication: WorkosAuthentication,
    options: AuthOptions,
): Promise<StoredOrganization | null> {
    const workosOrganizationId = tokenOrganizationId(authentication);
    if (!workosOrganizationId) {
        return null;
    }
    const known = await fetchOrganizations(authentication.accessToken, options)
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
    const token = await getAccessToken(options);
    if (!token) {
        throw new NotLoggedInError();
    }
    try {
        return await fetchOrganizations(token, options);
    } catch (error) {
        if (!(error instanceof ConsoleTokenRefusedError)) {
            throw error;
        }
        return fetchOrganizations(await refreshAccessToken(token, options), options);
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
 * Removes the stored login from this machine. Returns `false` when there was
 * none. WorkOS does not let a public client revoke a session, so a copied
 * refresh token stays valid until it expires.
 *
 * @since 3.8.0
 */
export function logout(options: AuthOptions = {}): Promise<boolean> {
    // Locked so a refresh in flight cannot write the login back afterwards.
    return withSessionLock(options, () => Promise.resolve(clearStoredAuth(options)));
}

/**
 * Describes the stored login without exposing its tokens. Makes no request.
 *
 * @since 3.8.0
 */
export function readAuthStatus(options: AuthOptions = {}): AuthStatus {
    const clientId = resolveClientId(options);
    const status: AuthStatus = { loggedIn: false, clientId, path: getAuthFilePath(options) };
    const stored = readStoredAuth(options);
    if (!stored) {
        return status;
    }
    const expiresAt = readJwtExpiryMs(stored.accessToken);
    return {
        ...status,
        loggedIn: true,
        user: stored.user,
        organization: stored.organization,
        ...(expiresAt === undefined ? {} : { accessTokenExpiresAt: expiresAt }),
    };
}

/** Whether a login issued for a different WorkOS client is on disk. */
export function hasLoginForOtherClient(options: AuthOptions = {}): boolean {
    const stored = readStoredAuthFile(options);
    return stored !== undefined && stored.clientId !== resolveClientId(options);
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
