import { LanguageCode } from '@vendure/common/lib/generated-types';
import { Job, Order, RequestContext } from '@vendure/core';
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

import { EmailRenderService } from '../email-render.service';
import { defineEmailTemplate } from '../template/email-template';

import {
    defaultEmails,
    orderCancelledEmail,
    orderConfirmationEmail,
    orderDeliveredEmail,
    orderRefundedEmail,
    orderShippedEmail,
    paymentFailedEmail,
} from './index';

const globals = {
    branding: { name: 'Test Shop', footerText: 'Test Shop, 1 Test Street' },
    verifyEmailAddressUrl: 'https://shop.test/verify',
    passwordResetUrl: 'https://shop.test/reset',
    adminPasswordResetUrl: 'https://shop.test/dashboard/reset-password',
    changeEmailAddressUrl: 'https://shop.test/change-email',
};

const order = {
    id: 1,
    code: 'T_1',
    state: 'PaymentSettled',
    currencyCode: 'USD',
    orderPlacedAt: new Date('2026-11-01T10:00:00Z'),
    subTotalWithTax: 12000,
    totalWithTax: 13000,
    customer: { firstName: 'Ada', lastName: 'Lovelace', emailAddress: 'ada@test.com' },
    shippingAddress: { fullName: 'Ada Lovelace', streetLine1: '1 Main St', city: 'London', country: 'UK' },
    lines: [{ quantity: 2, discountedLinePriceWithTax: 12000, productVariant: { name: 'Laptop' } }],
    discounts: [],
};

const dataByType: Record<string, Record<string, any>> = {
    'order-confirmation': { order, shippingLines: [{ priceWithTax: 1000, shippingMethod: { name: 'Express' } }] },
    'order-shipped': {
        order,
        fulfillment: { method: 'DHL', trackingCode: 'TRACK123', lines: [{ quantity: 2, productVariant: { name: 'Laptop' } }] },
    },
    'order-delivered': {
        order,
        fulfillment: { method: 'DHL', trackingCode: null, lines: [{ quantity: 2, productVariant: { name: 'Laptop' } }] },
    },
    'order-cancelled': { order },
    'order-refunded': { order, refund: { total: 5000, method: 'card', reason: 'Damaged' } },
    'payment-failed': { order, payment: { amount: 13000, method: 'card', errorMessage: 'Insufficient funds' } },
    'email-verification': { verificationToken: 'tok' },
    'password-reset': { passwordResetToken: 'tok' },
    'admin-password-reset': { passwordResetToken: 'tok' },
    'email-address-change': { identifierChangeToken: 'tok' },
};

function renderService(emails = defaultEmails) {
    return new EmailRenderService({ emails, templateLoaders: [], defaultFrom: '' } as any, {} as any);
}

/** Template vars pass through the job queue, so render what the worker would get. */
function serialized(vars: Record<string, any>) {
    return new Job({ queueName: 'send-email', data: vars }).data;
}

async function render(type: string, languageCode = LanguageCode.en) {
    const result = await renderService().render(RequestContext.empty(), {
        type,
        from: '"Test Shop" <noreply@test.com>',
        templateVars: serialized({ ...globals, ...dataByType[type] }),
        languageCode,
        channelCode: '__default_channel__',
    });
    const outDir = process.env.EMAIL_PREVIEW_DIR;
    if (outDir) {
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(path.join(outDir, `${type}.${languageCode}.html`), result.html);
    }
    return result;
}

describe('default emails', () => {
    it('have unique types and fixtures for each', () => {
        const types = defaultEmails.map(e => e.type);
        expect(new Set(types).size).toBe(types.length);
        expect(Object.keys(dataByType).sort()).toEqual([...types].sort());
    });

    for (const email of defaultEmails) {
        for (const languageCode of [LanguageCode.en, LanguageCode.de]) {
            it(`renders ${email.type} in ${languageCode}`, async () => {
                const result = await render(email.type, languageCode);
                expect(result.subject.length).toBeGreaterThan(0);
                expect(result.html).toContain('Test Shop');
                expect(result.text.length).toBeGreaterThan(0);
                expect(result.templateOrigin).toBe('package-default');
            });
        }
    }

    it('formats money in the email language', async () => {
        const en = await render('order-refunded', LanguageCode.en);
        const de = await render('order-refunded', LanguageCode.de);
        expect(en.html).toContain('$50.00');
        expect(de.html).toContain('50,00');
    });

    it('shows the tracking code in the shipped email', async () => {
        const result = await render('order-shipped');
        expect(result.subject).toBe('Your order #T_1 is on its way');
        expect(result.html).toContain('TRACK123');
        expect(result.text).toContain('Laptop');
        expect(result.text).toContain('Qty 2');
    });

    it('reports a project template as such', async () => {
        const custom = defineEmailTemplate<any>({ subject: 'Custom {{ order.code }}', body: () => <p>custom</p> });
        const service = renderService([{ ...orderCancelledEmail, template: custom }]);
        const result = await service.render(RequestContext.empty(), {
            type: 'order-cancelled',
            from: 'x',
            templateVars: { order },
            languageCode: LanguageCode.en,
            channelCode: 'c',
        });
        expect(result.templateOrigin).toBe('project');
        expect(result.subject).toBe('Custom T_1');
    });

    it('uses a template loader before the definition', async () => {
        const fromLoader = defineEmailTemplate<any>({ subject: 'Stored', body: () => <p>stored</p> });
        const service = new EmailRenderService(
            {
                emails: defaultEmails,
                templateLoaders: [{ name: 'database', load: (_i: any, _c: any, loadInput: any) => (loadInput.languageCode === 'de' ? fromLoader : undefined) }],
            } as any,
            {} as any,
        );
        const input = { type: 'order-cancelled', from: 'x', templateVars: serialized({ order }), channelCode: 'c' };
        const de = await service.render(RequestContext.empty(), { ...input, languageCode: LanguageCode.de });
        const en = await service.render(RequestContext.empty(), { ...input, languageCode: LanguageCode.en });
        expect(de.templateOrigin).toBe('loader:database');
        expect(de.subject).toBe('Stored');
        expect(en.templateOrigin).toBe('package-default');
    });
});

describe('order email eligibility', () => {
    const ctx = RequestContext.empty();
    const targets = (email: any, o: Partial<Order>) => email.orderSend.targets({ ctx, injector: {} as any, order: o as Order });

    it('order confirmation only once payment is settled', async () => {
        expect((await targets(orderConfirmationEmail, { ...order, state: 'ArrangingPayment' } as any))[0].eligible).toBe(false);
        expect((await targets(orderConfirmationEmail, { ...order, state: 'Shipped' } as any))[0].eligible).toBe(true);
    });

    it('order cancelled only for a cancelled order', async () => {
        expect((await targets(orderCancelledEmail, { ...order, state: 'PaymentSettled' } as any))[0].eligible).toBe(false);
        expect((await targets(orderCancelledEmail, { ...order, state: 'Cancelled' } as any))[0].eligible).toBe(true);
    });

    it('payment failed not when the order has a successful payment', async () => {
        const declined = { id: 1, state: 'Declined', amount: 100, method: 'card' };
        const settled = { id: 2, state: 'Settled', amount: 100, method: 'card' };
        const onlyDeclined = await targets(paymentFailedEmail, { ...order, payments: [declined] } as any);
        expect(onlyDeclined).toMatchObject([{ id: '1', eligible: true }]);
        const recovered = await targets(paymentFailedEmail, { ...order, payments: [declined, settled] } as any);
        expect(recovered).toMatchObject([
            { id: '1', eligible: false, reason: 'The order has a successful payment, so this failure no longer applies.' },
            { id: '2', eligible: false },
        ]);
    });

    it('shipped and delivered per fulfillment state', async () => {
        const fulfillments = [
            { id: 1, state: 'Pending', method: 'DHL' },
            { id: 2, state: 'Shipped', method: 'DHL', trackingCode: 'X' },
            { id: 3, state: 'Delivered', method: 'UPS' },
            { id: 4, state: 'Cancelled', method: 'UPS' },
        ];
        const shipped = await targets(orderShippedEmail, { ...order, fulfillments } as any);
        expect(shipped.map((t: any) => [t.id, t.eligible])).toEqual([
            ['1', false],
            ['2', true],
            ['3', true],
        ]);
        const delivered = await targets(orderDeliveredEmail, { ...order, fulfillments } as any);
        expect(delivered.map((t: any) => [t.id, t.eligible])).toEqual([
            ['1', false],
            ['2', false],
            ['3', true],
        ]);
    });

    it('refunded only for settled refunds', async () => {
        const payments = [
            {
                id: 1,
                method: 'card',
                refunds: [
                    { id: 7, state: 'Pending', total: 100 },
                    { id: 8, state: 'Settled', total: 200 },
                ],
            },
        ];
        const result = await targets(orderRefundedEmail, { ...order, payments } as any);
        expect(result.map((t: any) => [t.id, t.eligible])).toEqual([
            ['7', false],
            ['8', true],
        ]);
    });
});
