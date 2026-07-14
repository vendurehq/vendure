import { CurrencyCode, DeletionResult, ErrorCode } from '@vendure/common/lib/generated-shop-types';
import { dummyPaymentHandler, LanguageCode, PaymentMethodEligibilityChecker } from '@vendure/core';
import {
    createErrorResultGuard,
    createTestEnvironment,
    E2E_DEFAULT_CHANNEL_TOKEN,
    ErrorResultGuard,
} from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { FragmentOf, graphql } from './graphql/graphql-admin';
import { FragmentOf as FragmentOfShop, ResultOf as ResultOfShop } from './graphql/graphql-shop';
import { createChannelDocument } from './graphql/shared-definitions';
import {
    activePaymentMethodsQueryDocument,
    addItemToOrderDocument,
    addPaymentDocument,
    getEligiblePaymentMethodsDocument,
    testOrderWithPaymentsFragment,
} from './graphql/shop-definitions';
import { proceedToArrangingPayment } from './utils/test-order-utils';

const checkerSpy = vi.fn();

const minPriceChecker = new PaymentMethodEligibilityChecker({
    code: 'min-price-checker',
    description: [{ languageCode: LanguageCode.en, value: 'Min price checker' }],
    args: {
        minPrice: {
            type: 'int',
        },
    },
    check(ctx, order, args) {
        checkerSpy();
        if (order.totalWithTax >= args.minPrice) {
            return true;
        } else {
            return 'Order total too low';
        }
    },
});

describe('PaymentMethod resolver', () => {
    const orderGuard: ErrorResultGuard<FragmentOfShop<typeof testOrderWithPaymentsFragment>> =
        createErrorResultGuard(input => !!input.lines);

    type PaymentMethodType = FragmentOf<typeof paymentMethodFragment>;
    const paymentMethodGuard: ErrorResultGuard<PaymentMethodType> = createErrorResultGuard(
        input => !!input.id,
    );

    type ActivePaymentMethodType = NonNullable<
        ResultOfShop<typeof activePaymentMethodsQueryDocument>['activePaymentMethods'][number]
    >;
    const activePaymentMethodGuard: ErrorResultGuard<ActivePaymentMethodType> = createErrorResultGuard(
        input => !!input && !!input.id,
    );

    const { server, adminClient, shopClient } = createTestEnvironment({
        ...testConfig(),
        // logger: new DefaultLogger(),
        paymentOptions: {
            paymentMethodEligibilityCheckers: [minPriceChecker],
            paymentMethodHandlers: [dummyPaymentHandler],
        },
    });

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 2,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('create', async () => {
        const { createPaymentMethod } = await adminClient.query(createPaymentMethodDocument, {
            input: {
                code: 'no-checks',
                enabled: true,
                handler: {
                    code: dummyPaymentHandler.code,
                    arguments: [{ name: 'automaticSettle', value: 'true' }],
                },
                translations: [
                    {
                        languageCode: LanguageCode.en,
                        name: 'No Checker',
                        description: 'This is a test payment method',
                    },
                ],
            },
        });

        expect(createPaymentMethod).toEqual({
            id: 'T_1',
            name: 'No Checker',
            code: 'no-checks',
            description: 'This is a test payment method',
            enabled: true,
            checker: null,
            handler: {
                args: [
                    {
                        name: 'automaticSettle',
                        value: 'true',
                    },
                ],
                code: 'dummy-payment-handler',
            },
            translations: [
                {
                    description: 'This is a test payment method',
                    id: 'T_1',
                    languageCode: 'en',
                    name: 'No Checker',
                },
            ],
        });
    });

    it('update', async () => {
        const { updatePaymentMethod } = await adminClient.query(updatePaymentMethodDocument, {
            input: {
                id: 'T_1',
                checker: {
                    code: minPriceChecker.code,
                    arguments: [{ name: 'minPrice', value: '0' }],
                },
                handler: {
                    code: dummyPaymentHandler.code,
                    arguments: [{ name: 'automaticSettle', value: 'false' }],
                },
                translations: [
                    {
                        languageCode: LanguageCode.en,
                        description: 'modified',
                    },
                ],
            },
        });

        expect(updatePaymentMethod).toEqual({
            id: 'T_1',
            name: 'No Checker',
            code: 'no-checks',
            description: 'modified',
            enabled: true,
            checker: {
                args: [{ name: 'minPrice', value: '0' }],
                code: minPriceChecker.code,
            },
            handler: {
                args: [
                    {
                        name: 'automaticSettle',
                        value: 'false',
                    },
                ],
                code: dummyPaymentHandler.code,
            },
            translations: [
                {
                    description: 'modified',
                    id: 'T_1',
                    languageCode: 'en',
                    name: 'No Checker',
                },
            ],
        });
    });

    it('unset checker', async () => {
        const { updatePaymentMethod } = await adminClient.query(updatePaymentMethodDocument, {
            input: {
                id: 'T_1',
                checker: null,
            },
        });

        expect(updatePaymentMethod.checker).toEqual(null);

        const { paymentMethod } = await adminClient.query(getPaymentMethodDocument, { id: 'T_1' });
        paymentMethodGuard.assertSuccess(paymentMethod);
        expect(paymentMethod.checker).toEqual(null);
    });

    it('paymentMethodEligibilityCheckers', async () => {
        const { paymentMethodEligibilityCheckers } = await adminClient.query(
            getPaymentMethodCheckersDocument,
        );
        expect(paymentMethodEligibilityCheckers).toEqual([
            {
                code: minPriceChecker.code,
                args: [{ name: 'minPrice', type: 'int' }],
            },
        ]);
    });

    it('paymentMethodHandlers', async () => {
        const { paymentMethodHandlers } = await adminClient.query(getPaymentMethodHandlersDocument);
        expect(paymentMethodHandlers).toEqual([
            {
                code: dummyPaymentHandler.code,
                args: [{ name: 'automaticSettle', type: 'boolean' }],
            },
        ]);
    });

    describe('eligibility checks', () => {
        beforeAll(async () => {
            await adminClient.query(createPaymentMethodDocument, {
                input: {
                    code: 'price-check',
                    enabled: true,
                    checker: {
                        code: minPriceChecker.code,
                        arguments: [{ name: 'minPrice', value: '200000' }],
                    },
                    handler: {
                        code: dummyPaymentHandler.code,
                        arguments: [{ name: 'automaticSettle', value: 'true' }],
                    },
                    translations: [
                        {
                            languageCode: LanguageCode.en,
                            name: 'With Min Price Checker',
                            description: 'Order total must be more than 2k',
                        },
                    ],
                },
            });
            await adminClient.query(createPaymentMethodDocument, {
                input: {
                    code: 'disabled-method',
                    enabled: false,
                    handler: {
                        code: dummyPaymentHandler.code,
                        arguments: [{ name: 'automaticSettle', value: 'true' }],
                    },
                    translations: [
                        {
                            languageCode: LanguageCode.en,
                            name: 'Disabled ones',
                            description: 'This method is disabled',
                        },
                    ],
                },
            });

            await shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');
            await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_1',
                quantity: 1,
            });

            await proceedToArrangingPayment(shopClient);
        });

        it('eligiblePaymentMethods', async () => {
            const { eligiblePaymentMethods } = await shopClient.query(getEligiblePaymentMethodsDocument);
            expect(eligiblePaymentMethods).toEqual([
                {
                    id: 'T_1',
                    code: 'no-checks',
                    isEligible: true,
                    eligibilityMessage: null,
                },
                {
                    id: 'T_2',
                    code: 'price-check',
                    isEligible: false,
                    eligibilityMessage: 'Order total too low',
                },
            ]);
        });

        it('addPaymentToOrder does not allow ineligible method', async () => {
            checkerSpy.mockClear();
            const { addPaymentToOrder } = await shopClient.query(addPaymentDocument, {
                input: {
                    method: 'price-check',
                    metadata: {},
                },
            });

            orderGuard.assertErrorResult(addPaymentToOrder);

            expect(addPaymentToOrder.errorCode).toBe(ErrorCode.INELIGIBLE_PAYMENT_METHOD_ERROR);
            if ('eligibilityCheckerMessage' in addPaymentToOrder) {
                expect(addPaymentToOrder.eligibilityCheckerMessage).toBe('Order total too low');
            }
            expect(checkerSpy).toHaveBeenCalledTimes(1);
        });
    });

    describe('channels', () => {
        const SECOND_CHANNEL_TOKEN = 'SECOND_CHANNEL_TOKEN';
        const THIRD_CHANNEL_TOKEN = 'THIRD_CHANNEL_TOKEN';

        beforeAll(async () => {
            await adminClient.query(createChannelDocument, {
                input: {
                    code: 'second-channel',
                    token: SECOND_CHANNEL_TOKEN,
                    defaultLanguageCode: LanguageCode.en,
                    currencyCode: CurrencyCode.GBP,
                    pricesIncludeTax: true,
                    defaultShippingZoneId: 'T_1',
                    defaultTaxZoneId: 'T_1',
                },
            });
            await adminClient.query(createChannelDocument, {
                input: {
                    code: 'third-channel',
                    token: THIRD_CHANNEL_TOKEN,
                    defaultLanguageCode: LanguageCode.en,
                    currencyCode: CurrencyCode.GBP,
                    pricesIncludeTax: true,
                    defaultShippingZoneId: 'T_1',
                    defaultTaxZoneId: 'T_1',
                },
            });
        });

        it('creates a PaymentMethod in channel2', async () => {
            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            const { createPaymentMethod } = await adminClient.query(createPaymentMethodDocument, {
                input: {
                    code: 'channel-2-method',
                    enabled: true,
                    handler: {
                        code: dummyPaymentHandler.code,
                        arguments: [{ name: 'automaticSettle', value: 'true' }],
                    },
                    translations: [
                        {
                            languageCode: LanguageCode.en,
                            name: 'Channel 2 method',
                            description: 'This is a test payment method',
                        },
                    ],
                },
            });

            expect(createPaymentMethod.code).toBe('channel-2-method');
        });

        it('method is listed in channel2', async () => {
            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            const { paymentMethods } = await adminClient.query(getPaymentMethodListDocument);

            expect(paymentMethods.totalItems).toBe(1);
            expect(paymentMethods.items[0].code).toBe('channel-2-method');
        });

        it('method is not listed in channel3', async () => {
            adminClient.setChannelToken(THIRD_CHANNEL_TOKEN);
            const { paymentMethods } = await adminClient.query(getPaymentMethodListDocument);

            expect(paymentMethods.totalItems).toBe(0);
        });

        it('method is listed in default channel', async () => {
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const { paymentMethods } = await adminClient.query(getPaymentMethodListDocument);

            expect(paymentMethods.totalItems).toBe(4);
            expect(paymentMethods.items.map(i => i.code).sort()).toEqual([
                'channel-2-method',
                'disabled-method',
                'no-checks',
                'price-check',
            ]);
        });

        it('delete from channel', async () => {
            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            const { paymentMethods } = await adminClient.query(getPaymentMethodListDocument);

            expect(paymentMethods.totalItems).toBe(1);

            const { deletePaymentMethod } = await adminClient.query(deletePaymentMethodDocument, {
                id: paymentMethods.items[0].id,
            });

            expect(deletePaymentMethod.result).toBe(DeletionResult.DELETED);

            const { paymentMethods: checkChannel } = await adminClient.query(getPaymentMethodListDocument);
            expect(checkChannel.totalItems).toBe(0);

            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const { paymentMethods: checkDefault } = await adminClient.query(getPaymentMethodListDocument);
            expect(checkDefault.totalItems).toBe(4);
        });

        it('delete from default channel', async () => {
            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            const { createPaymentMethod } = await adminClient.query(createPaymentMethodDocument, {
                input: {
                    code: 'channel-2-method2',
                    enabled: true,
                    handler: {
                        code: dummyPaymentHandler.code,
                        arguments: [{ name: 'automaticSettle', value: 'true' }],
                    },
                    translations: [
                        {
                            languageCode: LanguageCode.en,
                            name: 'Channel 2 method 2',
                            description: 'This is a test payment method',
                        },
                    ],
                },
            });

            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const { deletePaymentMethod: delete1 } = await adminClient.query(deletePaymentMethodDocument, {
                id: createPaymentMethod.id,
            });

            expect(delete1.result).toBe(DeletionResult.NOT_DELETED);
            expect(delete1.message).toBe(
                'The selected PaymentMethod is assigned to the following Channels: second-channel. Set "force: true" to delete from all Channels.',
            );

            const { paymentMethods: check1 } = await adminClient.query(getPaymentMethodListDocument);
            expect(check1.totalItems).toBe(5);

            const { deletePaymentMethod: delete2 } = await adminClient.query(deletePaymentMethodDocument, {
                id: createPaymentMethod.id,
                force: true,
            });

            expect(delete2.result).toBe(DeletionResult.DELETED);

            const { paymentMethods: check2 } = await adminClient.query(getPaymentMethodListDocument);
            expect(check2.totalItems).toBe(4);
        });
    });

    it('create without description', async () => {
        const { createPaymentMethod } = await adminClient.query(createPaymentMethodDocument, {
            input: {
                code: 'no-description',
                enabled: true,
                handler: {
                    code: dummyPaymentHandler.code,
                    arguments: [{ name: 'automaticSettle', value: 'true' }],
                },
                translations: [
                    {
                        languageCode: LanguageCode.en,
                        name: 'No Description',
                    },
                ],
            },
        });

        expect(createPaymentMethod).toEqual({
            id: 'T_6',
            name: 'No Description',
            code: 'no-description',
            description: '',
            enabled: true,
            checker: null,
            handler: {
                args: [
                    {
                        name: 'automaticSettle',
                        value: 'true',
                    },
                ],
                code: 'dummy-payment-handler',
            },
            translations: [
                {
                    description: '',
                    id: 'T_6',
                    languageCode: 'en',
                    name: 'No Description',
                },
            ],
        });
    });

    it('returns only active payment methods', async () => {
        // Cleanup: Remove all existing payment methods
        const { paymentMethods } = await adminClient.query(getPaymentMethodListDocument);
        for (const method of paymentMethods.items) {
            await adminClient.query(deletePaymentMethodDocument, { id: method.id, force: true });
        }

        // Arrange: Create both enabled and disabled payment methods
        await adminClient.query(createPaymentMethodDocument, {
            input: {
                code: 'active-method',
                enabled: true,
                handler: {
                    code: 'dummy-payment-handler',
                    arguments: [{ name: 'automaticSettle', value: 'true' }],
                },
                translations: [
                    {
                        languageCode: LanguageCode.en,
                        name: 'Active Method',
                        description: 'This is an active method',
                    },
                ],
            },
        });

        await adminClient.query(createPaymentMethodDocument, {
            input: {
                code: 'inactive-method',
                enabled: false,
                handler: {
                    code: 'dummy-payment-handler',
                    arguments: [{ name: 'automaticSettle', value: 'true' }],
                },
                translations: [
                    {
                        languageCode: LanguageCode.en,
                        name: 'Inactive Method',
                        description: 'This is an inactive method',
                    },
                ],
            },
        });

        // Act: Query active payment methods
        const { activePaymentMethods } = await shopClient.query(activePaymentMethodsQueryDocument);

        // Assert: Ensure only the active payment method is returned
        expect(activePaymentMethods).toHaveLength(1);
        const activeMethod = activePaymentMethods[0];
        activePaymentMethodGuard.assertSuccess(activeMethod);
        expect(activeMethod.code).toBe('active-method');
        expect(activeMethod.name).toBe('Active Method');
        expect(activeMethod.description).toBe('This is an active method');
    });

    describe('cross-channel update protection', () => {
        const CHANNEL_A_TOKEN = 'CROSS_CHANNEL_A_TOKEN';
        const CHANNEL_B_TOKEN = 'CROSS_CHANNEL_B_TOKEN';

        beforeAll(async () => {
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            for (const [code, token] of [
                ['cross-channel-a', CHANNEL_A_TOKEN],
                ['cross-channel-b', CHANNEL_B_TOKEN],
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
        });

        // updatePaymentMethod must not modify a PaymentMethod that does not belong to the
        // active channel.
        it('cannot update a PaymentMethod belonging to another channel', async () => {
            adminClient.setChannelToken(CHANNEL_A_TOKEN);
            const { createPaymentMethod } = await adminClient.query(createPaymentMethodDocument, {
                input: {
                    code: 'cross-channel-target',
                    enabled: true,
                    handler: {
                        code: dummyPaymentHandler.code,
                        arguments: [{ name: 'automaticSettle', value: 'true' }],
                    },
                    translations: [
                        {
                            languageCode: LanguageCode.en,
                            name: 'Cross channel target',
                            description: 'original description',
                        },
                    ],
                },
            });
            const targetId = createPaymentMethod.id;

            // channel-b does not contain this method; attempting the update from there must fail.
            adminClient.setChannelToken(CHANNEL_B_TOKEN);
            await expect(
                adminClient.query(updatePaymentMethodDocument, {
                    input: {
                        id: targetId,
                        enabled: false,
                        translations: [
                            { languageCode: LanguageCode.en, name: 'Updated', description: 'updated' },
                        ],
                    },
                }),
            ).rejects.toThrow(/No PaymentMethod with the id .* could be found/);

            // The method in channel-a must be completely unchanged — the write must not commit.
            adminClient.setChannelToken(CHANNEL_A_TOKEN);
            const { paymentMethod } = await adminClient.query(getPaymentMethodDocument, { id: targetId });
            expect(paymentMethod?.enabled).toBe(true);
            expect(paymentMethod?.name).toBe('Cross channel target');
            expect(paymentMethod?.description).toBe('original description');

            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        });
    });
});

export const paymentMethodFragment = graphql(`
    fragment PaymentMethod on PaymentMethod {
        id
        code
        name
        description
        enabled
        checker {
            code
            args {
                name
                value
            }
        }
        handler {
            code
            args {
                name
                value
            }
        }
        translations {
            id
            languageCode
            name
            description
        }
    }
`);

export const createPaymentMethodDocument = graphql(
    `
        mutation CreatePaymentMethod($input: CreatePaymentMethodInput!) {
            createPaymentMethod(input: $input) {
                ...PaymentMethod
            }
        }
    `,
    [paymentMethodFragment],
);

export const updatePaymentMethodDocument = graphql(
    `
        mutation UpdatePaymentMethod($input: UpdatePaymentMethodInput!) {
            updatePaymentMethod(input: $input) {
                ...PaymentMethod
            }
        }
    `,
    [paymentMethodFragment],
);

export const getPaymentMethodHandlersDocument = graphql(`
    query GetPaymentMethodHandlers {
        paymentMethodHandlers {
            code
            args {
                name
                type
            }
        }
    }
`);

export const getPaymentMethodCheckersDocument = graphql(`
    query GetPaymentMethodCheckers {
        paymentMethodEligibilityCheckers {
            code
            args {
                name
                type
            }
        }
    }
`);

export const getPaymentMethodDocument = graphql(
    `
        query GetPaymentMethod($id: ID!) {
            paymentMethod(id: $id) {
                ...PaymentMethod
            }
        }
    `,
    [paymentMethodFragment],
);

export const getPaymentMethodListDocument = graphql(
    `
        query GetPaymentMethodList($options: PaymentMethodListOptions) {
            paymentMethods(options: $options) {
                items {
                    ...PaymentMethod
                }
                totalItems
            }
        }
    `,
    [paymentMethodFragment],
);

export const deletePaymentMethodDocument = graphql(`
    mutation DeletePaymentMethod($id: ID!, $force: Boolean) {
        deletePaymentMethod(id: $id, force: $force) {
            message
            result
        }
    }
`);
