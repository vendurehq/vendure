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

    /**
     * @param channelToken - runs the operation in that Channel (the `vendure-token` header);
     * defaults to the default Channel.
     */
    async gql(query: string, variables?: Record<string, unknown>, channelToken?: string) {
        if (!this.authToken) throw new Error('Call login() first');
        const response = await this.page.request.post(ADMIN_API, {
            headers: {
                Authorization: `Bearer ${this.authToken}`,
                ...(channelToken ? { 'vendure-token': channelToken } : {}),
            },
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

    /** Creates a Channel whose token is its code, using the seeded "Europe" zone. */
    async createChannel(code: string): Promise<{ id: string; token: string }> {
        const { zones } = await this.gql(
            `query { zones(options: { filter: { name: { eq: "Europe" } } }) { items { id } } }`,
        );
        const zoneId = zones.items[0].id as string;
        const { createChannel } = await this.gql(
            `mutation ($input: CreateChannelInput!) {
                createChannel(input: $input) { ... on Channel { id token } ... on ErrorResult { message } }
            }`,
            {
                input: {
                    code,
                    token: code,
                    defaultLanguageCode: 'en',
                    pricesIncludeTax: false,
                    defaultCurrencyCode: 'USD',
                    availableCurrencyCodes: ['USD'],
                    defaultTaxZoneId: zoneId,
                    defaultShippingZoneId: zoneId,
                },
            },
        );
        if (!createChannel.id) throw new Error(`createChannel failed: ${String(createChannel.message)}`);
        return createChannel;
    }

    async deleteChannel(id: string) {
        await this.gql(`mutation ($id: ID!) { deleteChannel(id: $id) { result } }`, { id });
    }
}
