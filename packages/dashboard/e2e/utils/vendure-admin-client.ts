import { type Page } from '@playwright/test';

import { VENDURE_PORT } from '../constants.js';

const ADMIN_API = `http://localhost:${VENDURE_PORT}/admin-api`;

/** Thin wrapper around Playwright's request API with Vendure bearer-token auth. */
export class VendureAdminClient {
    private authToken: string | null = null;
    constructor(private page: Page) {}

    async login(username = 'superadmin', password = 'superadmin') {
        const response = await this.page.request.post(ADMIN_API, {
            data: {
                query: `mutation ($u: String!, $p: String!) {
                    login(username: $u, password: $p) {
                        ... on CurrentUser { id }
                        ... on ErrorResult { errorCode message }
                    }
                }`,
                variables: { u: username, p: password },
            },
        });
        this.authToken = response.headers()['vendure-auth-token'] ?? null;
        const json = await response.json();
        if (json.errors?.length) {
            throw new Error(`Login failed: ${String(json.errors[0].message)}`);
        }
    }

    async gql(query: string, variables?: Record<string, unknown>) {
        if (!this.authToken) throw new Error('Call login() first');
        const response = await this.page.request.post(ADMIN_API, {
            headers: { Authorization: `Bearer ${this.authToken}` },
            data: { query, variables },
        });
        const newToken = response.headers()['vendure-auth-token'];
        if (newToken) this.authToken = newToken;
        const json = await response.json();
        if (json.errors?.length) {
            throw new Error(`GraphQL error: ${String(json.errors[0].message)}`);
        }
        return json.data;
    }
}
