import { classifyConsoleApiOrigin } from '../commands/console/console-origins';

import { AuthOptions } from './auth-options';
import { WorkosClient } from './workos-client';

/**
 * A Vendure Console Customer Account the signed-in user is an active member of.
 *
 * @since 3.8.0
 */
export interface AuthOrganization {
    /** The WorkOS organization (`org_…`) behind the Customer Account. */
    workosOrganizationId: string;
    /** The Customer Account id, shown in Vendure Console as the "Account identifier". */
    customerAccountId: string;
    name: string;
}

/** Console answered 401: the token was refused, so the caller may renew it and retry once. */
export class ConsoleTokenRefusedError extends Error {
    constructor() {
        super('Vendure Console did not accept the CLI login.');
        this.name = 'ConsoleTokenRefusedError';
    }
}

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOSTNAME = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

/**
 * Reads the WorkOS application from Console's public `GET /v1`. Console
 * verifies tokens against the same client id, so a login made with it is one
 * that Console accepts.
 */
export async function fetchWorkosClient(
    consoleApiUrl: string,
    options: AuthOptions = {},
): Promise<WorkosClient> {
    const response = await consoleRequest(consoleApiUrl, '/v1', { method: 'GET' }, options);
    if (!response.ok) {
        throw new Error(
            `Could not read the sign-in settings from Vendure Console at ${consoleApiUrl} (HTTP ${response.status}).`,
        );
    }
    const body = await readJson(response);
    const authentication = isRecord(body) ? body.authentication : undefined;
    if (
        !isRecord(authentication) ||
        authentication.provider !== 'workos' ||
        typeof authentication.clientId !== 'string' ||
        !authentication.clientId.startsWith('client_') ||
        typeof authentication.apiHostname !== 'string' ||
        !HOSTNAME.test(authentication.apiHostname)
    ) {
        throw new Error(`Vendure Console at ${consoleApiUrl} returned malformed sign-in settings.`);
    }
    return { clientId: authentication.clientId, apiHostname: authentication.apiHostname };
}

/**
 * Lists the Customer Accounts of the token's user from Console's `GET /v1/me`.
 *
 * Console answers with the memberships of the user the token belongs to and of
 * nobody else, and accepts a token that is not yet scoped to any organization.
 * Pending and inactive memberships, and WorkOS organizations Console does not
 * know as a Customer Account, are left out.
 */
export async function fetchOrganizations(
    consoleApiUrl: string,
    accessToken: string,
    options: AuthOptions = {},
): Promise<AuthOrganization[]> {
    const response = await consoleRequest(
        consoleApiUrl,
        '/v1/me',
        { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } },
        options,
    );
    if (response.status === 401) {
        throw new ConsoleTokenRefusedError();
    }
    if (!response.ok) {
        throw new Error(`Vendure Console answered the organization lookup with HTTP ${response.status}.`);
    }
    return parseMemberships(await readJson(response));
}

/**
 * Ends the WorkOS session behind the token through Console's
 * `POST /v1/me/sign-out`. Console records the session as signed out and asks
 * WorkOS to revoke it, so a copy of the refresh token stops working too.
 * Returns whether Console confirmed it.
 */
export async function signOut(
    consoleApiUrl: string,
    accessToken: string,
    options: AuthOptions = {},
): Promise<boolean> {
    const response = await consoleRequest(
        consoleApiUrl,
        '/v1/me/sign-out',
        { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } },
        options,
    );
    return response.ok;
}

async function consoleRequest(
    consoleApiUrl: string,
    pathname: string,
    init: RequestInit,
    options: AuthOptions,
): Promise<Response> {
    // The URL can come from `auth.json`, so it is checked again here rather than trusted.
    const consoleApi = classifyConsoleApiOrigin(consoleApiUrl);
    if (!consoleApi) {
        throw new Error(`${consoleApiUrl} is not a Vendure Console API.`);
    }
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    try {
        return await (options.fetch ?? globalThis.fetch)(`${consoleApi.apiOrigin}${pathname}`, {
            ...init,
            headers: { Accept: 'application/json', ...(init.headers as Record<string, string>) },
            // A bearer token must not follow a redirect to another host.
            redirect: 'error',
            signal,
        });
    } catch (error) {
        if (options.signal?.aborted) throw error;
        throw new Error(`Could not reach Vendure Console at ${consoleApi.apiOrigin}.`);
    }
}

async function readJson(response: Response): Promise<unknown> {
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
        throw new Error('Vendure Console returned an oversized response.');
    }
    try {
        return JSON.parse(text);
    } catch {
        throw new Error('Vendure Console returned a response that is not JSON.');
    }
}

function parseMemberships(body: unknown): AuthOrganization[] {
    if (!isRecord(body) || !Array.isArray(body.memberships)) {
        throw new Error('Vendure Console returned a malformed organization list.');
    }
    const organizations: AuthOrganization[] = [];
    for (const membership of body.memberships) {
        if (
            isRecord(membership) &&
            membership.status === 'active' &&
            typeof membership.organizationId === 'string' &&
            membership.organizationId.startsWith('org_') &&
            typeof membership.customerAccountId === 'string' &&
            UUID.test(membership.customerAccountId) &&
            typeof membership.name === 'string'
        ) {
            organizations.push({
                workosOrganizationId: membership.organizationId,
                customerAccountId: membership.customerAccountId,
                name: membership.name,
            });
        }
    }
    return organizations;
}

/**
 * Finds the organization a user named on the command line.
 *
 * An Account identifier matches exactly. Anything else matches a name, ignoring
 * case and surrounding spaces. Names are not unique in Console, so two matches
 * are refused rather than guessed between.
 */
export function resolveOrganization(organizations: AuthOrganization[], input: string): AuthOrganization {
    const wanted = input.trim();
    const matches = UUID.test(wanted)
        ? organizations.filter(org => org.customerAccountId.toLowerCase() === wanted.toLowerCase())
        : organizations.filter(org => org.name.trim().toLowerCase() === wanted.toLowerCase());
    if (matches.length === 1) {
        return matches[0];
    }
    if (matches.length > 1) {
        throw new Error(
            `More than one of your organizations is named "${wanted}". ` +
                `Pass its Account identifier instead:\n${describeOrganizations(matches)}`,
        );
    }
    throw new Error(
        organizations.length
            ? `You are not an active member of an organization "${wanted}". Your organizations:\n${describeOrganizations(organizations)}`
            : 'You are not an active member of any Vendure Console organization.',
    );
}

function describeOrganizations(organizations: AuthOrganization[]): string {
    return organizations.map(org => `  ${org.name} (${org.customerAccountId})`).join('\n');
}

function isRecord(value: unknown): value is Record<string, any> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
