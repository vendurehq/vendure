import {
    AdministratorEvent,
    defaultShippingCalculator,
    defaultShippingEligibilityChecker,
    dummyPaymentHandler,
    EventBus,
    LanguageCode,
    PaymentMethodEvent,
    PromotionCondition,
    PromotionEvent,
    PromotionOrderAction,
    ShippingMethodEvent,
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'path';
import { firstValueFrom } from 'rxjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import {
    createAdministratorDocument,
    createPromotionDocument,
    createRoleDocument,
    createShippingMethodDocument,
    updateAdministratorDocument,
    updatePromotionDocument,
    updateShippingMethodDocument,
} from './graphql/shared-definitions';

/* eslint-disable @typescript-eslint/no-non-null-assertion */

const testPromoCondition = new PromotionCondition({
    code: 'test_event_condition',
    description: [{ languageCode: LanguageCode.en, value: 'Test event condition' }],
    args: { arg: { type: 'int' } },
    check: (_order, _args) => true,
});

const testPromoAction = new PromotionOrderAction({
    code: 'test_event_action',
    description: [{ languageCode: LanguageCode.en, value: 'Test event action' }],
    args: {},
    execute: (_order, _args) => {
        return 0;
    },
});

/**
 * Tests that VendureEntityEvent subclasses emit the post-update entity state,
 * not the pre-update state.
 *
 * See https://github.com/vendurehq/vendure/issues/4351
 */
describe('Entity event updated state', () => {
    const { server, adminClient } = createTestEnvironment({
        ...testConfig(),
        promotionOptions: {
            promotionConditions: [testPromoCondition],
            promotionActions: [testPromoAction],
        },
        shippingOptions: {
            shippingEligibilityCheckers: [defaultShippingEligibilityChecker],
            shippingCalculators: [defaultShippingCalculator],
        },
        paymentOptions: {
            paymentMethodHandlers: [dummyPaymentHandler],
        },
    });

    let eventBus: EventBus;

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
        eventBus = server.app.get(EventBus);
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    describe('PromotionEvent', () => {
        let promotionId: string;

        it('setup: create promotion', async () => {
            const { createPromotion } = await adminClient.query(createPromotionDocument, {
                input: {
                    enabled: true,
                    couponCode: 'EVENT_TEST',
                    conditions: [
                        {
                            code: testPromoCondition.code,
                            arguments: [{ name: 'arg', value: '500' }],
                        },
                    ],
                    actions: [
                        {
                            code: testPromoAction.code,
                            arguments: [],
                        },
                    ],
                    translations: [
                        {
                            languageCode: LanguageCode.en,
                            name: 'Event Test Promotion',
                        },
                    ],
                },
            });
            promotionId = (createPromotion as any).id;
            expect(promotionId).toBeDefined();
        });

        it('emits post-update entity when enabled is changed', async () => {
            const eventPromise = firstValueFrom(eventBus.ofType(PromotionEvent));

            await adminClient.query(updatePromotionDocument, {
                input: {
                    id: promotionId,
                    enabled: false,
                },
            });

            const event = await eventPromise;

            expect(event.type).toBe('updated');
            expect(event.entity.enabled).toBe(false);
        });

        it('emits post-update entity when name is changed', async () => {
            const eventPromise = firstValueFrom(eventBus.ofType(PromotionEvent));

            await adminClient.query(updatePromotionDocument, {
                input: {
                    id: promotionId,
                    translations: [
                        {
                            languageCode: LanguageCode.en,
                            name: 'Updated Promotion Name',
                        },
                    ],
                },
            });

            const event = await eventPromise;

            expect(event.type).toBe('updated');
            const enTranslation = event.entity.translations.find(t => t.languageCode === LanguageCode.en);
            expect(enTranslation?.name).toBe('Updated Promotion Name');
        });
    });

    describe('ShippingMethodEvent', () => {
        let shippingMethodId: string;

        it('setup: create shipping method', async () => {
            const { createShippingMethod } = await adminClient.query(createShippingMethodDocument, {
                input: {
                    code: 'event-test-shipping',
                    fulfillmentHandler: 'manual-fulfillment',
                    checker: {
                        code: defaultShippingEligibilityChecker.code,
                        arguments: [{ name: 'orderMinimum', value: '0' }],
                    },
                    calculator: {
                        code: defaultShippingCalculator.code,
                        arguments: [
                            { name: 'rate', value: '500' },
                            { name: 'includesTax', value: 'auto' },
                            { name: 'taxRate', value: '0' },
                        ],
                    },
                    translations: [
                        {
                            languageCode: LanguageCode.en,
                            name: 'Event Test Shipping',
                            description: 'test',
                        },
                    ],
                },
            });
            shippingMethodId = createShippingMethod.id;
            expect(shippingMethodId).toBeDefined();
        });

        it('emits post-update entity when name is changed', async () => {
            const eventPromise = firstValueFrom(eventBus.ofType(ShippingMethodEvent));

            await adminClient.query(updateShippingMethodDocument, {
                input: {
                    id: shippingMethodId,
                    translations: [
                        {
                            languageCode: LanguageCode.en,
                            name: 'Updated Shipping Name',
                            description: 'updated test',
                        },
                    ],
                },
            });

            const event = await eventPromise;

            expect(event.type).toBe('updated');
            const enTranslation = event.entity.translations.find(t => t.languageCode === LanguageCode.en);
            expect(enTranslation?.name).toBe('Updated Shipping Name');
        });

        it('emits post-update entity when calculator is changed', async () => {
            const eventPromise = firstValueFrom(eventBus.ofType(ShippingMethodEvent));

            await adminClient.query(updateShippingMethodDocument, {
                input: {
                    id: shippingMethodId,
                    calculator: {
                        code: defaultShippingCalculator.code,
                        arguments: [
                            { name: 'rate', value: '999' },
                            { name: 'includesTax', value: 'auto' },
                            { name: 'taxRate', value: '0' },
                        ],
                    },
                    translations: [
                        {
                            languageCode: LanguageCode.en,
                            name: 'Updated Shipping Name',
                            description: 'updated test',
                        },
                    ],
                },
            });

            const event = await eventPromise;

            expect(event.type).toBe('updated');
            const rateArg = event.entity.calculator.args.find(a => a.name === 'rate');
            expect(rateArg?.value).toBe('999');
        });
    });

    describe('AdministratorEvent', () => {
        let administratorId: string;
        let testRoleId: string;

        it('setup: create role and administrator', async () => {
            const { createRole } = await adminClient.query(createRoleDocument, {
                input: {
                    code: 'event-test-role',
                    description: 'A test role for event testing',
                    permissions: [],
                },
            });
            testRoleId = createRole.id;

            const { createAdministrator } = await adminClient.query(createAdministratorDocument, {
                input: {
                    firstName: 'Event',
                    lastName: 'TestAdmin',
                    emailAddress: 'event-test-admin@test.com',
                    password: 'test123',
                    roleIds: [testRoleId],
                },
            });
            administratorId = createAdministrator.id;
            expect(administratorId).toBeDefined();
        });

        it('emits post-update entity when name is changed', async () => {
            const eventPromise = firstValueFrom(eventBus.ofType(AdministratorEvent));

            await adminClient.query(updateAdministratorDocument, {
                input: {
                    id: administratorId,
                    lastName: 'UpdatedLastName',
                },
            });

            const event = await eventPromise;

            expect(event.type).toBe('updated');
            expect(event.entity.lastName).toBe('UpdatedLastName');
        });

        it('emits post-update entity when roles are changed', async () => {
            const { createRole } = await adminClient.query(createRoleDocument, {
                input: {
                    code: 'event-test-role-2',
                    description: 'Second test role',
                    permissions: [],
                },
            });
            const secondRoleId = createRole.id;

            const eventPromise = firstValueFrom(eventBus.ofType(AdministratorEvent));

            await adminClient.query(updateAdministratorDocument, {
                input: {
                    id: administratorId,
                    roleIds: [testRoleId, secondRoleId],
                },
            });

            const event = await eventPromise;

            expect(event.type).toBe('updated');
            const roleCodes = event.entity.user.roles.map(r => r.code);
            expect(roleCodes).toContain('event-test-role');
            expect(roleCodes).toContain('event-test-role-2');
        });
    });

    describe('PaymentMethodEvent', () => {
        let paymentMethodId: string;

        it('setup: create payment method', async () => {
            const { createPaymentMethod } = await adminClient.query(CREATE_PAYMENT_METHOD, {
                input: {
                    code: 'event-test-payment',
                    enabled: true,
                    handler: {
                        code: dummyPaymentHandler.code,
                        arguments: [{ name: 'automaticSettle', value: 'false' }],
                    },
                    translations: [
                        {
                            languageCode: 'en',
                            name: 'Event Test Payment',
                            description: 'test',
                        },
                    ],
                },
            });
            paymentMethodId = createPaymentMethod.id;
            expect(paymentMethodId).toBeDefined();
        });

        it('emits event after entity is fully persisted', async () => {
            const eventPromise = firstValueFrom(eventBus.ofType(PaymentMethodEvent));

            await adminClient.query(UPDATE_PAYMENT_METHOD, {
                input: {
                    id: paymentMethodId,
                    enabled: false,
                    translations: [
                        {
                            languageCode: 'en',
                            name: 'Updated Payment Method',
                            description: 'updated test',
                        },
                    ],
                },
            });

            const event = await eventPromise;

            expect(event.type).toBe('updated');
            expect(event.entity.enabled).toBe(false);
        });
    });
});

const PAYMENT_METHOD_FRAGMENT = gql`
    fragment PaymentMethodTest on PaymentMethod {
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
`;

const CREATE_PAYMENT_METHOD = gql`
    mutation CreatePaymentMethodEventTest($input: CreatePaymentMethodInput!) {
        createPaymentMethod(input: $input) {
            ...PaymentMethodTest
        }
    }
    ${PAYMENT_METHOD_FRAGMENT}
`;

const UPDATE_PAYMENT_METHOD = gql`
    mutation UpdatePaymentMethodEventTest($input: UpdatePaymentMethodInput!) {
        updatePaymentMethod(input: $input) {
            ...PaymentMethodTest
        }
    }
    ${PAYMENT_METHOD_FRAGMENT}
`;
