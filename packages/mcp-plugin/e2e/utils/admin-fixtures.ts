import { SimpleGraphQLClient } from '@vendure/testing';
import gql from 'graphql-tag';

export interface AdminProvisioningContext {
    adminClient: SimpleGraphQLClient;
    /** Fully-qualified admin API URL, e.g. `http://localhost:3050/admin-api`. */
    adminApiUrl: string;
    /** GraphQL id of the channel the new role is scoped to. */
    channelId: string;
}

/**
 * Creates an administrator with exactly these permissions and returns its login token. `key` names
 * the role, the administrator's first name and its email address.
 *
 * Logs in with a plain fetch rather than `adminClient.asUserWithCredentials` so that the caller's
 * shared superadmin session on `adminClient` is never disturbed.
 */
export async function provisionAdmin(
    context: AdminProvisioningContext,
    key: string,
    permissions: string[],
): Promise<string> {
    const { adminClient, adminApiUrl, channelId } = context;
    const email = `${key}@example.test`;
    const role = await adminClient.query(
        gql`
            mutation CreateRole($input: CreateRoleInput!) {
                createRole(input: $input) {
                    id
                }
            }
        `,
        {
            input: {
                code: `mcp-${key}-role`,
                description: `${key} role`,
                permissions,
                channelIds: [channelId],
            },
        },
    );
    await adminClient.query(
        gql`
            mutation CreateAdmin($input: CreateAdministratorInput!) {
                createAdministrator(input: $input) {
                    id
                }
            }
        `,
        {
            input: {
                firstName: key,
                lastName: 'Admin',
                emailAddress: email,
                password: 'test',
                roleIds: [role.createRole.id],
            },
        },
    );
    const response = await fetch(adminApiUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            query: `
                mutation Login($username: String!, $password: String!) {
                    login(username: $username, password: $password) {
                        __typename
                    }
                }
            `,
            variables: { username: email, password: 'test' },
        }),
    });
    const token = response.headers.get('vendure-auth-token');
    if (!token) {
        throw new Error(`Login failed for ${key}: ${await response.text()}`);
    }
    return token;
}
