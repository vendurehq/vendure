import { AuthOptions, resolveConsoleApiUrl } from './auth-options';

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

/**
 * Lists the Customer Accounts of the token's user from Console's `GET /v1/me`.
 *
 * Console answers with the memberships of the user the token belongs to and of
 * nobody else, and accepts a token that is not yet scoped to any organization.
 * Pending and inactive memberships, and WorkOS organizations Console does not
 * know as a Customer Account, are left out.
 */
export async function fetchOrganizations(
    accessToken: string,
    options: AuthOptions = {},
): Promise<AuthOrganization[]> {
    const apiUrl = resolveConsoleApiUrl(options);
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    let response: Response;
    try {
        response = await (options.fetch ?? globalThis.fetch)(`${apiUrl}/v1/me`, {
            method: 'GET',
            // The token must not follow a redirect to another host.
            redirect: 'error',
            signal,
            headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
        });
    } catch (error) {
        if (options.signal?.aborted) throw error;
        throw new Error('Could not reach Vendure Console to look up your organizations.');
    }
    if (response.status === 401) {
        throw new ConsoleTokenRefusedError();
    }
    if (!response.ok) {
        throw new Error(`Vendure Console answered the organization lookup with HTTP ${response.status}.`);
    }
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
        throw new Error('Vendure Console returned an oversized organization list.');
    }
    return parseMemberships(JSON.parse(text));
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
 * case. Names are not unique in Console, so two matches are refused rather than
 * guessed between.
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
