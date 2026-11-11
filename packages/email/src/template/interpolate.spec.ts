import { describe, expect, it } from 'vitest';

import { interpolateTemplateString } from './interpolate';

describe('interpolateTemplateString()', () => {
    const vars = {
        order: { code: 'ABC', customer: { firstName: 'Ann' }, lines: [{ name: 'Mug' }] },
        count: 0,
        html: '<b>&</b>',
    };

    it('replaces simple and nested paths', () => {
        expect(
            interpolateTemplateString('Order #{{ order.code }} for {{order.customer.firstName}}', vars),
        ).toBe('Order #ABC for Ann');
    });

    it('supports array indices', () => {
        expect(interpolateTemplateString('{{ order.lines.0.name }} {{ order.lines[0].name }}', vars)).toBe(
            'Mug Mug',
        );
    });

    it('accepts triple braces', () => {
        expect(interpolateTemplateString('{{{ order.code }}}', vars)).toBe('ABC');
    });

    it('does not escape HTML', () => {
        expect(interpolateTemplateString('{{ html }}', vars)).toBe('<b>&</b>');
    });

    it('renders falsy values but replaces missing values with an empty string', () => {
        expect(interpolateTemplateString('[{{ count }}][{{ missing.path }}]', vars)).toBe('[0][]');
    });

    it('leaves Handlebars helpers and blocks untouched', () => {
        expect(interpolateTemplateString('{{ formatMoney total }} {{#if x}}', vars)).toBe(
            '{{ formatMoney total }} {{#if x}}',
        );
    });
});
