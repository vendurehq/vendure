import { AdjustmentType } from '@vendure/common/lib/generated-shop-types';
import {
    AccountRegistrationEvent,
    CurrencyCode,
    Customer,
    IdentifierChangeRequestEvent,
    NativeAuthenticationMethod,
    Order,
    OrderLine,
    OrderStateTransitionEvent,
    PasswordResetEvent,
    ProductVariant,
    ShippingLine,
    User,
} from '@vendure/core';

export const mockOrderStateTransitionEvent = new OrderStateTransitionEvent(
    'ArrangingPayment',
    'PaymentSettled',
    {} as any,
    new Order({
        id: '6',
        currencyCode: CurrencyCode.USD,
        createdAt: '2018-10-31T11:18:29.261Z',
        updatedAt: '2018-10-31T15:24:17.000Z',
        orderPlacedAt: '2018-10-31T13:54:17.000Z',
        code: 'T3EPGJKTVZPBD6Z9',
        state: 'ArrangingPayment',
        active: true,
        customer: new Customer({
            id: '3',
            firstName: 'Test',
            lastName: 'Customer',
            emailAddress: 'test@test.com',
        }),
        lines: [
            new OrderLine({
                id: '5',
                featuredAsset: {
                    preview: '/mailbox/placeholder-image',
                },
                productVariant: new ProductVariant({
                    id: '2',
                    name: 'Curvy Monitor 24 inch',
                    sku: 'C24F390',
                }),
                quantity: 1,
                listPrice: 14374,
                listPriceIncludesTax: true,
                adjustments: [
                    {
                        adjustmentSource: 'Promotion:1',
                        type: AdjustmentType.PROMOTION,
                        amount: -1000 as any,
                        description: '$10 off computer equipment',
                    },
                ],
                taxLines: [],
            }),
            new OrderLine({
                id: '6',
                featuredAsset: {
                    preview: '/mailbox/placeholder-image',
                },
                productVariant: new ProductVariant({
                    id: '4',
                    name: 'Hard Drive 1TB',
                    sku: 'IHD455T1',
                }),
                quantity: 1,
                listPrice: 3799,
                listPriceIncludesTax: true,
                adjustments: [],
                taxLines: [],
            }),
        ],
        subTotal: 15144,
        subTotalWithTax: 18173,
        shipping: 1000,
        shippingLines: [
            new ShippingLine({
                listPrice: 1000,
                listPriceIncludesTax: true,
                taxLines: [{ taxRate: 20, description: 'shipping tax' }],
                shippingMethod: {
                    code: 'express-flat-rate',
                    name: 'Express Shipping',
                    description: 'Express Shipping',
                    id: '2',
                },
            }),
        ],
        surcharges: [],
        shippingAddress: {
            fullName: 'Test Customer',
            company: '',
            streetLine1: '6000 Pagac Land',
            streetLine2: '',
            city: 'Port Kirsten',
            province: 'Avon',
            postalCode: 'ZU32 9CP',
            country: 'Cabo Verde',
            phoneNumber: '',
        },
        payments: [],
    }),
);

export const mockAccountRegistrationEvent = new AccountRegistrationEvent(
    {} as any,
    new User({
        verified: false,
        authenticationMethods: [
            new NativeAuthenticationMethod({
                identifier: 'test@test.com',
                verificationToken: 'MjAxOC0xMS0xM1QxNToxNToxNC42ODda_US2U6UK1WZC7NDAX',
            }),
        ],
        identifier: 'test@test.com',
    }),
);

export const mockPasswordResetEvent = new PasswordResetEvent(
    {} as any,
    new User({
        identifier: 'test@test.com',
        authenticationMethods: [
            new NativeAuthenticationMethod({
                passwordResetToken: 'MjAxOS0wNC0xNVQxMzozMDozOC43MjFa_MA2FR6HRZBW7JWD6',
            }),
        ],
    }),
);

export const mockEmailAddressChangeEvent = new IdentifierChangeRequestEvent(
    {} as any,
    new User({
        identifier: 'old-address@test.com',
        authenticationMethods: [
            new NativeAuthenticationMethod({
                pendingIdentifier: 'new-address@test.com',
                identifierChangeToken: 'MjAxOS0wNC0xNVQxMzozMDozOC43MjFa_MA2FR6HRZBW7JWD6',
            }),
        ],
    }),
);
