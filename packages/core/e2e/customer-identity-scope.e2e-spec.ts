/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { OnModuleInit } from '@nestjs/common';
import { CurrencyCode, LanguageCode } from '@vendure/common/lib/generated-types';
import {
    CustomerChannelAssignmentStrategy,
    EventBus,
    EventBusModule,
    mergeConfig,
    PasswordResetEvent,
    VendurePlugin,
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import {
    assignProductToChannelDocument,
    attemptLoginDocument,
    createChannelDocument,
    createCustomerDocument,
    getCustomerListDocument,
    MeDocument,
} from './graphql/shared-definitions';
import {
    addItemToOrderDocument,
    getActiveCustomerDocument,
    registerAccountDocument,
    requestPasswordResetDocument,
    setCustomerDocument,
} from './graphql/shop-definitions';
import { assertThrowsWithMessage } from './utils/assert-throws-with-message';

/**
 * OSS-999 spike: channel-scoped Customer/User identity.
 *
 * Two brands share one Vendure instance and must have independent customer bases, so the same
 * email address is a different person (different password, profile and orders) on each brand.
 *
 * Today the closest a deployment can get is a CustomerChannelAssignmentStrategy that never
 * auto-joins a customer to another channel. That stops an existing session from gaining
 * `Authenticated` on the other brand, but identity is still resolved globally by email, so the
 * tests below marked "fails today" show what goes wrong.
 */

const BRAND_A = { code: 'brand-a', token: 'brand-a-token' };
const BRAND_B = { code: 'brand-b', token: 'brand-b-token' };
const FORBIDDEN_MESSAGE = 'You are not currently authorized to perform this action';

class NeverAutoJoinStrategy implements CustomerChannelAssignmentStrategy {
    canAssignCustomerToChannel(): boolean {
        return false;
    }
}

const passwordResetEvents: PasswordResetEvent[] = [];

@VendurePlugin({ imports: [EventBusModule] })
class CapturePasswordResetPlugin implements OnModuleInit {
    constructor(private eventBus: EventBus) {}
    onModuleInit() {
        this.eventBus.ofType(PasswordResetEvent).subscribe(e => passwordResetEvents.push(e));
    }
}

describe('Customer identity scope (OSS-999)', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            authOptions: {
                requireVerification: false,
                customerChannelAssignmentStrategy: new NeverAutoJoinStrategy(),
            },
            plugins: [CapturePasswordResetPlugin],
        }),
    );

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
        for (const { code, token } of [BRAND_A, BRAND_B]) {
            const { createChannel } = await adminClient.query(createChannelDocument, {
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
            if (!('id' in createChannel)) {
                throw new Error('channel not created');
            }
            await adminClient.query(assignProductToChannelDocument, {
                input: { channelId: createChannel.id, productIds: ['T_1'] },
            });
        }
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    beforeEach(() => {
        passwordResetEvents.length = 0;
    });

    async function register(channelToken: string, emailAddress: string, password: string, firstName: string) {
        shopClient.setChannelToken(channelToken);
        await shopClient.asAnonymousUser();
        const { registerCustomerAccount } = await shopClient.query(registerAccountDocument, {
            input: { emailAddress, password, firstName, lastName: 'Test' },
        });
        return registerCustomerAccount;
    }

    async function login(channelToken: string, username: string, password: string) {
        shopClient.setChannelToken(channelToken);
        await shopClient.asAnonymousUser();
        const { login: result } = await shopClient.query(attemptLoginDocument, { username, password });
        shopClient.setChannelToken(channelToken);
        return result;
    }

    async function customersOn(channelToken: string, emailAddress: string) {
        adminClient.setChannelToken(channelToken);
        const { customers } = await adminClient.query(getCustomerListDocument, {
            options: { filter: { emailAddress: { eq: emailAddress } } },
        });
        return customers.items;
    }

    async function guestCheckout(channelToken: string, emailAddress: string, firstName: string) {
        shopClient.setChannelToken(channelToken);
        await shopClient.asAnonymousUser();
        await shopClient.query(addItemToOrderDocument, { productVariantId: 'T_1', quantity: 1 });
        const { setCustomerForOrder } = await shopClient.query(setCustomerDocument, {
            input: { emailAddress, firstName, lastName: 'Guest' },
        });
        return setCustomerForOrder;
    }

    it('the same email can register an independent account on each brand', async () => {
        expect(await register(BRAND_A.token, 'alice@test.com', 'alice-a-pass', 'AliceA')).toEqual({
            success: true,
        });
        expect(await register(BRAND_B.token, 'alice@test.com', 'alice-b-pass', 'AliceB')).toEqual({
            success: true,
        });

        // Fails today: brand B's registration silently returned success without creating anything,
        // so the brand B password does not work.
        const loginB = await login(BRAND_B.token, 'alice@test.com', 'alice-b-pass');
        expect((loginB as any).identifier).toBe('alice@test.com');
        const loginA = await login(BRAND_A.token, 'alice@test.com', 'alice-a-pass');
        expect((loginA as any).identifier).toBe('alice@test.com');

        const [onA] = await customersOn(BRAND_A.token, 'alice@test.com');
        const [onB] = await customersOn(BRAND_B.token, 'alice@test.com');
        expect(onA.firstName).toBe('AliceA');
        expect(onB?.firstName).toBe('AliceB');
        expect(onB?.id).not.toBe(onA.id);
    });

    it("brand A's password does not log in on brand B", async () => {
        await register(BRAND_A.token, 'dave@test.com', 'dave-a-pass', 'Dave');
        // Fails today: the User is found globally by email, so the login succeeds and creates a
        // session (it only lacks permissions on B because of the no-autojoin strategy).
        const result = await login(BRAND_B.token, 'dave@test.com', 'dave-a-pass');
        expect((result as any).errorCode).toBe('INVALID_CREDENTIALS_ERROR');
    });

    it("a session from brand A does not authenticate on brand B", async () => {
        await login(BRAND_A.token, 'alice@test.com', 'alice-a-pass');
        const { me } = await shopClient.query(MeDocument);
        expect(me?.identifier).toBe('alice@test.com');

        shopClient.setChannelToken(BRAND_B.token);
        await assertThrowsWithMessage(() => shopClient.query(MeDocument), FORBIDDEN_MESSAGE)();
        const { activeCustomer } = await shopClient.query(getActiveCustomerDocument);
        expect(activeCustomer).toBeNull();
    });

    it('guest checkout on brand B with an email registered on brand A', async () => {
        await register(BRAND_A.token, 'bob@test.com', 'bob-a-pass', 'BobA');
        const result = await guestCheckout(BRAND_B.token, 'bob@test.com', 'BobB');
        // Fails today with EMAIL_ADDRESS_CONFLICT_ERROR.
        expect((result as any).errorCode).toBeUndefined();
        const [onA] = await customersOn(BRAND_A.token, 'bob@test.com');
        expect((result as any).customer.id).not.toBe(onA.id);
        expect(onA.firstName).toBe('BobA');
    });

    it("guest checkout on brand B does not touch brand A's guest customer", async () => {
        const first = await guestCheckout(BRAND_A.token, 'carol@test.com', 'CarolA');
        const second = await guestCheckout(BRAND_B.token, 'carol@test.com', 'CarolB');
        // Fails today: the brand A Customer is reused, renamed to CarolB and joined to brand B.
        expect((second as any).customer.id).not.toBe((first as any).customer.id);
        const [onA] = await customersOn(BRAND_A.token, 'carol@test.com');
        expect(onA.firstName).toBe('CarolA');
    });

    it('an admin creating a customer on brand B does not merge with brand A', async () => {
        await register(BRAND_A.token, 'erin@test.com', 'erin-a-pass', 'ErinA');
        adminClient.setChannelToken(BRAND_B.token);
        const { createCustomer } = await adminClient.query(createCustomerDocument, {
            input: { emailAddress: 'erin@test.com', firstName: 'ErinB', lastName: 'Test' },
        });
        // Fails today: the brand A Customer is patched (renamed ErinB) and joined to brand B.
        const [onA] = await customersOn(BRAND_A.token, 'erin@test.com');
        expect(onA.firstName).toBe('ErinA');
        expect((createCustomer as any).id).not.toBe(onA.id);
    });

    it('password reset on brand B for an email that only exists on brand A', async () => {
        await register(BRAND_A.token, 'frank@test.com', 'frank-a-pass', 'Frank');
        shopClient.setChannelToken(BRAND_B.token);
        await shopClient.asAnonymousUser();
        // Fails today: "Cannot locate a Customer for the user" (#3469), which also discloses that
        // the email has an account somewhere on the instance.
        const { requestPasswordReset } = await shopClient.query(requestPasswordResetDocument, {
            identifier: 'frank@test.com',
        });
        expect(requestPasswordReset).toEqual({ success: true });
        // Events are published after the transaction commits.
        await new Promise(resolve => setTimeout(resolve, 300));
        expect(passwordResetEvents.length).toBe(0);
    });

    it('password reset on brand A works for the brand A account', async () => {
        shopClient.setChannelToken(BRAND_A.token);
        await shopClient.asAnonymousUser();
        const { requestPasswordReset } = await shopClient.query(requestPasswordResetDocument, {
            identifier: 'frank@test.com',
        });
        expect(requestPasswordReset).toEqual({ success: true });
        await new Promise(resolve => setTimeout(resolve, 300));
        expect(passwordResetEvents.length).toBe(1);
    });
});
