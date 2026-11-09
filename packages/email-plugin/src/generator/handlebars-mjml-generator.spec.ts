import { describe, expect, it } from 'vitest';

import { HandlebarsMjmlGenerator } from './handlebars-mjml-generator';

describe('HandlebarsMjmlGenerator', () => {
    const generator = new HandlebarsMjmlGenerator();
    const emptyTemplate = '<mjml><mj-body></mj-body></mjml>';

    // OSS-946 — the subject is plain text, so interpolated values must not be HTML-escaped
    it('does not HTML-escape interpolated values in the subject', async () => {
        const { subject } = await generator.generate(
            'noreply@test.com',
            'Your order from {{ shopName }}',
            emptyTemplate,
            { shopName: 'Mac & Cheese' },
        );

        expect(subject).toBe('Your order from Mac & Cheese');
    });

    // OSS-946 — every character that Handlebars would escape stays as typed
    it('keeps <, >, quotes, backticks and = in the subject as typed', async () => {
        const { subject } = await generator.generate(
            'noreply@test.com',
            '{{ name }}',
            emptyTemplate,
            { name: `<b>"it's" a=\`b\`</b>` },
        );

        expect(subject).toBe(`<b>"it's" a=\`b\`</b>`);
    });

    // OSS-946 — only the subject and `from` are plain text. The body is HTML and still escapes.
    it('still HTML-escapes interpolated values in the body', async () => {
        const { body } = await generator.generate(
            'noreply@test.com',
            'Subject',
            '<mjml><mj-body><mj-section><mj-column><mj-text>{{ shopName }}</mj-text></mj-column></mj-section></mj-body></mjml>',
            { shopName: 'Mac & Cheese' },
        );

        expect(body).toContain('Mac &amp; Cheese');
    });
});
