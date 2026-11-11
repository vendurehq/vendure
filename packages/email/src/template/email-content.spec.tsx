import { LanguageCode } from '@vendure/common/lib/generated-types';
import { RequestContext } from '@vendure/core';
import { describe, expect, it } from 'vitest';

import { EmailRenderService } from '../email-render.service';
import { orderRefundedEmail, OrderRefundedTemplate, OrderShippedTemplate } from '../emails';

import { listEmailVariables, resolveEmailContent, validateEmailContent } from './email-content';

const order = {
    code: 'T_1',
    currencyCode: 'USD',
    subTotalWithTax: 1000,
    totalWithTax: 1000,
    lines: [],
    customer: { firstName: 'Ada', lastName: 'Lovelace' },
};
const context = { languageCode: 'en', channelCode: 'default' };

describe('resolveEmailContent()', () => {
    const props = { order, fulfillment: { method: 'DHL', trackingCode: 'X1', lines: [] }, branding: { name: 'Shop' } };

    it('uses the draft, then the channel text, then the all-channels text, then the default', () => {
        const { values, origins } = resolveEmailContent(
            OrderShippedTemplate,
            props,
            context,
            { channel: { title: 'Channel title' }, allChannels: { title: 'All title', intro: 'All intro' } },
            { subject: 'Draft {{ orderCode }}' },
        );
        expect(values.subject).toBe('Draft T_1');
        expect(origins.subject).toBe('draft');
        expect(values.title).toBe('Channel title');
        expect(origins.title).toBe('channel');
        expect(values.intro).toBe('All intro');
        expect(origins.intro).toBe('all-channels');
        expect(values.shipmentHeading).toBe('In this shipment');
        expect(origins.shipmentHeading).toBe('default');
    });

    it('treats empty text as not set', () => {
        const { origins } = resolveEmailContent(OrderShippedTemplate, props, context, { channel: { title: '  ' } });
        expect(origins.title).toBe('default');
    });

    it('fills in template and built-in variables', () => {
        const { values } = resolveEmailContent(OrderShippedTemplate, props, context, {}, {
            intro: '{{ customerFirstName }}, {{ trackingCode }} from {{ shopName }}',
        });
        expect(values.intro).toBe('Ada, X1 from Shop');
    });

    it('formats money variables in the email language', () => {
        const refundProps = { order, refund: { total: 5000 } };
        const de = resolveEmailContent(OrderRefundedTemplate, refundProps, { ...context, languageCode: 'de' }, {}, {
            intro: '{{ refundAmount }}',
        });
        expect(de.values.intro).toContain('50,00');
    });
});

describe('validateEmailContent()', () => {
    it('accepts known slots and variables', () => {
        expect(validateEmailContent(OrderShippedTemplate, { intro: 'Hi {{ customerFirstName }} at {{ shopName }}' })).toEqual(
            [],
        );
    });

    it('rejects unknown variables and slots', () => {
        const problems = validateEmailContent(OrderShippedTemplate, {
            intro: 'Hi {{ order.customer.firstName }}',
            nope: 'x',
        });
        expect(problems).toHaveLength(2);
        expect(problems[0]).toContain('{{ order.customer.firstName }} is not a variable');
        expect(problems[1]).toContain('"nope" is not a content slot');
    });

    it('lists the variables with labels', () => {
        const names = listEmailVariables(OrderRefundedTemplate).map(v => v.name);
        expect(names).toEqual(expect.arrayContaining(['shopName', 'orderCode', 'refundAmount', 'refundReason']));
    });
});

describe('rendering with content', () => {
    function service(overrides: { channel?: Record<string, string>; allChannels?: Record<string, string> }) {
        const contentService = { getOverrides: () => Promise.resolve(overrides) };
        return new EmailRenderService(
            { emails: [orderRefundedEmail], templateLoaders: [] } as any,
            {} as any,
            contentService as any,
        );
    }

    it('uses stored text for the subject and body, and reports where each slot came from', async () => {
        const result = await service({ allChannels: { subject: 'Money back for {{ orderCode }}', title: 'Refund!' } }).render(
            RequestContext.empty(),
            {
                type: 'order-refunded',
                from: 'x',
                templateVars: { order, refund: { total: 5000 } },
                languageCode: LanguageCode.en,
                channelCode: 'default',
                contentDraft: { note: 'Draft note' },
            },
        );
        expect(result.subject).toBe('Money back for T_1');
        expect(result.html).toContain('Refund!');
        expect(result.html).toContain('Draft note');
        expect(result.contentOrigins).toMatchObject({ subject: 'all-channels', title: 'all-channels', note: 'draft', intro: 'default' });
    });
});
