import { LanguageCode } from '@vendure/common/lib/generated-types';
import { RequestContext } from '@vendure/core';
import { describe, expect, it } from 'vitest';

import { EmailRenderService } from '../email-render.service';
import { orderShippedEmail, passwordResetEmail } from '../emails';

import { EmailDesign, emailFontStacks, mergeEmailDesigns, validateEmailDesign } from './design';

describe('validateEmailDesign()', () => {
    it('accepts valid settings and null, which removes a setting', () => {
        expect(
            validateEmailDesign({
                primaryColor: '#0b7285',
                logoUrl: 'https://shop.example/logo.png',
                logoHeight: 40,
                headerAlign: 'center',
                fontFamily: emailFontStacks[4].value,
                cardRadius: 0,
                footerText: 'Shop Ltd, 1 High Street',
                pageBackground: null,
            }),
        ).toEqual([]);
    });

    it('rejects values that could break out of the CSS or the HTML', () => {
        const problems = validateEmailDesign({
            primaryColor: 'red; background: url(x)',
            logoUrl: 'javascript:alert(1)',
            fontFamily: 'Arial; color: red',
            cardRadius: 100,
            headerAlign: 'right',
            nope: 'x',
        });
        expect(problems).toEqual([
            'Brand colour: use a colour like #1a2b3c.',
            'Logo URL: use an absolute http or https URL.',
            'Font: pick one of the offered fonts.',
            'Card corner radius: use a whole number from 0 to 32.',
            'Header alignment: use left or center.',
            '"nope" is not a design setting.',
        ]);
    });
});

describe('mergeEmailDesigns()', () => {
    it('lets later designs win and ignores empty values', () => {
        expect(
            mergeEmailDesigns(
                { primaryColor: '#111111', name: 'All' },
                { primaryColor: '#222222', name: '' },
                undefined,
            ),
        ).toEqual({ primaryColor: '#222222', name: 'All' });
    });
});

describe('rendering with a design', () => {
    const order = {
        code: 'T_1',
        currencyCode: 'USD',
        subTotalWithTax: 1000,
        totalWithTax: 1000,
        lines: [],
        customer: { firstName: 'Ada', lastName: 'Lovelace' },
    };

    function service(stored: EmailDesign) {
        const designService = {
            resolve: (_ctx: unknown, draft?: EmailDesign) =>
                Promise.resolve({ design: mergeEmailDesigns(stored, draft), origins: {} }),
        };
        return new EmailRenderService(
            { emails: [orderShippedEmail, passwordResetEmail], templateLoaders: [] } as any,
            {} as any,
            undefined,
            designService as any,
        );
    }

    async function render(stored: EmailDesign, input: { type?: string; designDraft?: EmailDesign } = {}) {
        return service(stored).render(RequestContext.empty(), {
            type: input.type ?? 'password-reset',
            from: 'x',
            templateVars: {
                order,
                fulfillment: { method: 'DHL', trackingCode: 'X1', lines: [] },
                passwordResetUrl: 'https://shop.example/reset?token=t',
                branding: { name: 'Code name', primaryColor: '#ff0000' },
            },
            languageCode: LanguageCode.en,
            channelCode: 'default',
            designDraft: input.designDraft,
        });
    }

    it('uses the code branding when nothing is stored', async () => {
        const { html } = await render({});
        expect(html).toContain('Code name');
        expect(html).toContain('background-color:#ff0000');
    });

    it('applies the stored design over the code branding', async () => {
        const { html } = await render({
            name: 'Dashboard name',
            primaryColor: '#0b7285',
            primaryTextColor: '#000000',
            pageBackground: '#123456',
            cardBackground: '#fefefe',
            cardRadius: 0,
            buttonRadius: 20,
            fontFamily: emailFontStacks[4].value,
            headerAlign: 'center',
            footerText: 'Dashboard footer',
        });
        expect(html).toContain('Dashboard name');
        expect(html).not.toContain('Code name');
        expect(html).toContain('background-color:#0b7285');
        expect(html).not.toContain('#ff0000');
        expect(html).toContain('background-color:#123456');
        expect(html).toContain('background-color:#fefefe');
        expect(html).toContain('border-radius:0px');
        expect(html).toContain('border-radius:20px');
        expect(html).toContain('Georgia');
        expect(html).toContain('text-align:center');
        expect(html).toContain('Dashboard footer');
    });

    it('applies an unsaved draft over the stored design', async () => {
        const { html } = await render({ primaryColor: '#0b7285' }, { designDraft: { primaryColor: '#abcdef' } });
        expect(html).toContain('background-color:#abcdef');
        expect(html).not.toContain('#0b7285');
    });

    it('shows the logo at the set height', async () => {
        const { html } = await render(
            { logoUrl: 'https://shop.example/logo.png', logoHeight: 48 },
            { type: 'order-shipped' },
        );
        expect(html).toContain('src="https://shop.example/logo.png"');
        expect(html).toContain('height:48px');
    });
});
