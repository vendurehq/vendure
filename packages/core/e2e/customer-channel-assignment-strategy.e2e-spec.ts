import { CurrencyCode, LanguageCode } from '@vendure/common/lib/generated-types';
import { CustomerChannelAssignmentStrategy, mergeConfig, RequestContext } from '@vendure/core';
import { createTestEnvironment, E2E_DEFAULT_CHANNEL_TOKEN } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { ResultOf } from './graphql/graphql-admin';
import { createChannelDocument, getCustomerListDocument, MeDocument } from './graphql/shared-definitions';
import { getProductsTake3Document } from './graphql/shop-definitions';

const NO_AUTOJOIN_CHANNEL_CODE = 'no-autojoin-channel';
const NO_AUTOJOIN_CHANNEL_TOKEN = 'no_autojoin_channel_token';
const OPEN_CHANNEL_CODE = 'open-channel';
const OPEN_CHANNEL_TOKEN = 'open_channel_token';

/**
 * Suppresses the silent auto-join for the no-autojoin channel. Every other channel behaves as the
 * default (auto-join).
 */
class TestCustomerChannelAssignmentStrategy implements CustomerChannelAssignmentStrategy {
    canAssignCustomerToChannel(ctx: RequestContext): boolean {
        return ctx.channel.code !== NO_AUTOJOIN_CHANNEL_CODE;
    }
}

type CustomerListItem = ResultOf<typeof getCustomerListDocument>['customers']['items'][number];

describe('CustomerChannelAssignmentStrategy', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            authOptions: {
                customerChannelAssignmentStrategy: new TestCustomerChannelAssignmentStrategy(),
            },
        }),
    );
    let customer: CustomerListItem;

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();

        const { customers } = await adminClient.query(getCustomerListDocument, { options: { take: 1 } });
        customer = customers.items[0];

        for (const [code, token] of [
            [NO_AUTOJOIN_CHANNEL_CODE, NO_AUTOJOIN_CHANNEL_TOKEN],
            [OPEN_CHANNEL_CODE, OPEN_CHANNEL_TOKEN],
        ]) {
            await adminClient.query(createChannelDocument, {
                input: {
                    code,
                    token,
                    defaultLanguageCode: LanguageCode.en,
                    currencyCode: CurrencyCode.GBP,
                    pricesIncludeTax: true,
                    defaultShippingZoneId: 'T_1',
                    defaultTaxZoneId: 'T_1',
                },
            });
        }
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    async function channelMembers(token: string) {
        adminClient.setChannelToken(token);
        const { customers } = await adminClient.query(getCustomerListDocument);
        return customers.items.map(c => c.emailAddress);
    }

    it('lets an authenticated non-member operate on a no-autojoin channel without persisting membership', async () => {
        shopClient.setChannelToken(NO_AUTOJOIN_CHANNEL_TOKEN);
        await shopClient.asUserWithCredentials(customer.emailAddress, 'test');

        // The authenticated, customer-scoped query succeeds.
        const { me } = await shopClient.query(MeDocument);
        expect(me?.identifier).toBe(customer.emailAddress);

        // But the Customer is not recorded as a member of the channel.
        expect(await channelMembers(NO_AUTOJOIN_CHANNEL_TOKEN)).not.toContain(customer.emailAddress);
    });

    it('auto-joins the customer on an open channel', async () => {
        shopClient.setChannelToken(OPEN_CHANNEL_TOKEN);
        await shopClient.asUserWithCredentials(customer.emailAddress, 'test');
        await shopClient.query(MeDocument);

        expect(await channelMembers(OPEN_CHANNEL_TOKEN)).toContain(customer.emailAddress);
    });

    it('re-evaluates per channel when the active channel changes mid-session', async () => {
        shopClient.setChannelToken(OPEN_CHANNEL_TOKEN);
        await shopClient.asUserWithCredentials(customer.emailAddress, 'test');

        shopClient.setChannelToken(NO_AUTOJOIN_CHANNEL_TOKEN);
        const { me } = await shopClient.query(MeDocument);
        expect(me?.identifier).toBe(customer.emailAddress);

        expect(await channelMembers(NO_AUTOJOIN_CHANNEL_TOKEN)).not.toContain(customer.emailAddress);
    });

    it('allows an anonymous public query on a no-autojoin channel', async () => {
        shopClient.setChannelToken(NO_AUTOJOIN_CHANNEL_TOKEN);
        await shopClient.asAnonymousUser();
        const { products } = await shopClient.query(getProductsTake3Document);
        expect(Array.isArray(products.items)).toBe(true);
    });

    it('skips an authenticated user that has no Customer record', async () => {
        // The SuperAdmin user has no Customer, so the auto-join path must skip it on a non-default
        // channel rather than failing.
        adminClient.setChannelToken(NO_AUTOJOIN_CHANNEL_TOKEN);
        const { customers } = await adminClient.query(getCustomerListDocument);
        expect(Array.isArray(customers.items)).toBe(true);
    });
});

describe('default channel is never gated', () => {
    class NeverAssignStrategy implements CustomerChannelAssignmentStrategy {
        canAssignCustomerToChannel(): boolean {
            return false;
        }
    }

    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            authOptions: { customerChannelAssignmentStrategy: new NeverAssignStrategy() },
        }),
    );
    let email: string;

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
        const { customers } = await adminClient.query(getCustomerListDocument, { options: { take: 1 } });
        email = customers.items[0].emailAddress;
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('still authenticates on the default channel under a never-assign strategy', async () => {
        shopClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        await shopClient.asUserWithCredentials(email, 'test');
        const { me } = await shopClient.query(MeDocument);
        expect(me?.identifier).toBe(email);
    });
});
