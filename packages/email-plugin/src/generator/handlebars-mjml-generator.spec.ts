import { describe, expect, it } from 'vitest';

import { InitializedEmailPluginOptions } from '../types';

import { HandlebarsMjmlGenerator } from './handlebars-mjml-generator';

const bodyWith = (content: string) =>
    `<mjml><mj-body><mj-section><mj-column><mj-text>${content}</mj-text></mj-column></mj-section></mj-body></mjml>`;

/**
 * Handlebars partials are registered globally, so each test uses its own partial name
 * to start from an uncompiled partial.
 */
async function generatorWithPartial(name: string, content: string) {
    const generator = new HandlebarsMjmlGenerator();
    await generator.onInit({
        templateLoader: { loadPartials: async () => [{ name, content }] },
    } as unknown as InitializedEmailPluginOptions);
    return generator;
}

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
        const { body } = await generator.generate('noreply@test.com', 'Subject', bodyWith('{{ shopName }}'), {
            shopName: '<script>alert(1)</script> Mac & Cheese',
        });

        expect(body).toContain('&lt;script&gt;alert(1)&lt;/script&gt; Mac &amp; Cheese');
        expect(body).not.toContain('<script>');
    });

    // OSS-946 — Handlebars caches a partial compiled by the first template that uses it.
    // A partial first used in the subject must not be cached without escaping for the body.
    it('HTML-escapes a partial in the body after the subject used it', async () => {
        const generator = await generatorWithPartial('subjectFirstShopName', '{{ shopName }}');
        const templateVars = { shopName: '<script>alert(1)</script>' };

        const first = await generator.generate(
            'noreply@test.com',
            '{{> subjectFirstShopName }}',
            emptyTemplate,
            templateVars,
        );
        const second = await generator.generate(
            'noreply@test.com',
            'Subject',
            bodyWith('{{> subjectFirstShopName }}'),
            templateVars,
        );

        expect(first.subject).toBe('<script>alert(1)</script>');
        expect(second.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(second.body).not.toContain('<script>');
    });

    // OSS-946 — the reverse order: a partial the body compiled first stays unescaped in the subject
    it('does not HTML-escape a partial in the subject after the body used it', async () => {
        const generator = await generatorWithPartial('bodyFirstShopName', '{{ shopName }}');
        const templateVars = { shopName: 'Mac & Cheese' };

        const first = await generator.generate(
            'noreply@test.com',
            'Subject',
            bodyWith('{{> bodyFirstShopName }}'),
            templateVars,
        );
        const second = await generator.generate(
            'noreply@test.com',
            'Your order from {{> bodyFirstShopName }}',
            emptyTemplate,
            templateVars,
        );

        expect(first.body).toContain('Mac &amp; Cheese');
        expect(second.subject).toBe('Your order from Mac & Cheese');
    });
});
