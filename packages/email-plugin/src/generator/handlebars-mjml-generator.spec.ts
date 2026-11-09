import { describe, expect, it } from 'vitest';

import { HandlebarsMjmlGenerator } from './handlebars-mjml-generator';

/**
 * The subject is plain text, but it is compiled with Handlebars HTML escaping, unlike `from`
 * (which uses `noEscape`). A subject variable containing `&` reaches the inbox as `&amp;`.
 */
describe('HandlebarsMjmlGenerator subject', () => {
    // OSS-946 — the subject is plain text and must not be HTML-escaped
    it('does not HTML-escape interpolated values in the subject', async () => {
        const generator = new HandlebarsMjmlGenerator();

        const { subject } = await generator.generate(
            'noreply@test.com',
            'Your order from {{ shopName }}',
            '<mjml><mj-body></mj-body></mjml>',
            { shopName: 'Mac & Cheese' },
        );

        expect(subject).toBe('Your order from Mac & Cheese');
    });
});
