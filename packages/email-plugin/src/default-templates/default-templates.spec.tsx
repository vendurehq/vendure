import { LanguageCode } from '@vendure/common/lib/generated-types';
import { Job, RequestContext } from '@vendure/core';
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

import { ReactEmailGenerator } from '../generator/react-email-generator';
import {
    adminPasswordResetHandler,
    emailAddressChangeHandler,
    emailVerificationHandler,
    orderConfirmationHandler,
    passwordResetHandler,
} from '../handler/default-email-handlers';
import { mockOrderStateTransitionEvent } from '../handler/mock-events';

const globals = {
    fromAddress: '"Test Shop" <noreply@test.com>',
    verifyEmailAddressUrl: 'https://shop.test/verify',
    passwordResetUrl: 'https://shop.test/reset',
    adminPasswordResetUrl: 'https://shop.test/dashboard/reset-password',
    changeEmailAddressUrl: 'https://shop.test/change-email',
};

/**
 * Template vars pass through the job queue in production, which turns entity getters into plain
 * properties and Dates into ISO strings. Rendering the serialized form keeps the tests honest.
 */
function serialize<T>(vars: T): T {
    return new Job({ queueName: 'send-email', data: vars as any }).data as T;
}

async function renderDefault(
    handler: { template?: any; type: string },
    templateVars: Record<string, any>,
    languageCode = LanguageCode.en,
) {
    const result = await new ReactEmailGenerator().generate({
        ctx: RequestContext.empty(),
        type: handler.type,
        languageCode,
        channelCode: '__default_channel__',
        template: handler.template,
        from: '{{ fromAddress }}',
        subject: 'test',
        templateVars: serialize({ ...globals, ...templateVars }),
    });
    const outDir = process.env.EMAIL_PREVIEW_DIR;
    if (outDir) {
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(path.join(outDir, `${handler.type}.${languageCode}.html`), result.body);
    }
    return result;
}

describe('default React email templates', () => {
    it('every default handler has a React template', () => {
        for (const handler of [
            orderConfirmationHandler,
            emailVerificationHandler,
            passwordResetHandler,
            adminPasswordResetHandler,
            emailAddressChangeHandler,
        ]) {
            expect(handler.template?.kind, handler.type).toBe('react');
        }
    });

    describe('order-confirmation', () => {
        const order = mockOrderStateTransitionEvent.order;
        const vars = { order, shippingLines: order.shippingLines };

        it('renders the order details from serialized template vars', async () => {
            const { body, text } = await renderDefault(orderConfirmationHandler, vars);
            expect(body).toContain('Dear Test Customer,');
            expect(body).toContain(order.code);
            expect(body).toContain('1 x Curvy Monitor 24 inch');
            expect(body).toContain('$10 off computer equipment');
            expect(body).toContain('/mailbox/placeholder-image?w=50&amp;h=50');
            expect(text).toContain('Thank you for your order!');
        });

        it('formats money and dates in the language of the email', async () => {
            const en = await renderDefault(orderConfirmationHandler, vars, LanguageCode.en);
            const de = await renderDefault(orderConfirmationHandler, vars, LanguageCode.de);
            expect(en.body).toContain('Oct 31, 2018');
            expect(en.body).toMatch(/\$\d+\.\d{2}/);
            expect(de.body).toContain('31.10.2018');
            expect(de.body).toMatch(/\d+,\d{2}\s\$/);
        });

        it('renders the branding header and footer when set', async () => {
            const plain = await renderDefault(orderConfirmationHandler, vars);
            expect(plain.body).not.toContain('[company header]');

            const { body } = await renderDefault(orderConfirmationHandler, {
                ...vars,
                branding: { name: 'Acme Store', footerText: 'Acme Ltd, 1 High St', primaryColor: '#123456' },
            });
            expect(body).toContain('Acme Store');
            expect(body).toContain('Acme Ltd, 1 High St');
            expect(body).toContain('#123456');
        });
    });

    it('email-verification links to the verification page with the token', async () => {
        const { body } = await renderDefault(emailVerificationHandler, { verificationToken: 'abc 123' });
        expect(body).toContain('href="https://shop.test/verify?token=abc%20123"');
    });

    it('password-reset links to the reset page with the token', async () => {
        const { body } = await renderDefault(passwordResetHandler, { passwordResetToken: 'p1' });
        expect(body).toContain('href="https://shop.test/reset?token=p1"');
        expect(body).toContain('Someone requested a new password for your account.');
    });

    it('admin-password-reset links to the dashboard reset page', async () => {
        const { body } = await renderDefault(adminPasswordResetHandler, { passwordResetToken: 'a1' });
        expect(body).toContain('href="https://shop.test/dashboard/reset-password?token=a1"');
        expect(body).toContain('administrator account');
    });

    it('email-address-change links to the change page with the token', async () => {
        const { body } = await renderDefault(emailAddressChangeHandler, { identifierChangeToken: 'c1' });
        expect(body).toContain('href="https://shop.test/change-email?token=c1"');
    });
});
