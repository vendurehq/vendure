import { ConfigurableOperationDefFragment } from '@/vdb/graphql/fragments.js';
import { describe, expect, it } from 'vitest';

import {
    descriptionIncludesAdjacentAffix,
    formatScalarArgValue,
    parseOperationDescription,
} from './configurable-operation-description.js';

type ConfigArgDef = ConfigurableOperationDefFragment['args'][number];

const argDef = (overrides: Partial<ConfigArgDef>): ConfigArgDef =>
    ({
        name: 'test',
        type: 'string',
        required: true,
        defaultValue: null,
        list: false,
        ui: null,
        label: 'Test',
        description: null,
        ...overrides,
    }) as ConfigArgDef;

describe('parseOperationDescription', () => {
    it('splits text and referenced args in order', () => {
        const minimum = argDef({ name: 'minimum', type: 'int' });
        const segments = parseOperationDescription({
            description: 'buy at least { minimum } of the specified products',
            args: [minimum],
        });
        expect(segments).toEqual([
            { type: 'text', text: 'buy at least ' },
            { type: 'arg', arg: minimum, referenced: true },
            { type: 'text', text: ' of the specified products' },
        ]);
    });

    it('appends args not referenced in the template as trailing segments', () => {
        const minimum = argDef({ name: 'minimum', type: 'int' });
        const productVariantIds = argDef({ name: 'productVariantIds', type: 'ID', list: true });
        const segments = parseOperationDescription({
            description: 'buy at least { minimum } of the specified products',
            args: [minimum, productVariantIds],
        });
        expect(segments.at(-1)).toEqual({ type: 'arg', arg: productVariantIds, referenced: false });
    });

    it('matches placeholders case-insensitively like interpolateDescription', () => {
        const discount = argDef({ name: 'discount', type: 'int' });
        const segments = parseOperationDescription({
            description: 'discount by { Discount }%',
            args: [discount],
        });
        expect(segments).toEqual([
            { type: 'text', text: 'discount by ' },
            { type: 'arg', arg: discount, referenced: true },
            { type: 'text', text: '%' },
        ]);
    });

    it('leaves unknown placeholders as literal text', () => {
        const segments = parseOperationDescription({
            description: 'apply { mystery } discount',
            args: [],
        });
        expect(segments).toEqual([{ type: 'text', text: 'apply { mystery } discount' }]);
    });

    it('handles adjacent placeholders and templates with no text', () => {
        const a = argDef({ name: 'a' });
        const b = argDef({ name: 'b' });
        const segments = parseOperationDescription({
            description: '{a}{b}',
            args: [a, b],
        });
        expect(segments).toEqual([
            { type: 'arg', arg: a, referenced: true },
            { type: 'arg', arg: b, referenced: true },
        ]);
    });

    it('excludes combination-mode args from trailing segments', () => {
        const combineWithAnd = argDef({
            name: 'combineWithAnd',
            type: 'boolean',
            ui: { component: 'combination-mode-form-input' },
        });
        const segments = parseOperationDescription({
            description: 'some condition',
            args: [combineWithAnd],
        });
        expect(segments).toEqual([{ type: 'text', text: 'some condition' }]);
    });

    it('references each arg only once even if the placeholder repeats', () => {
        const amount = argDef({ name: 'amount', type: 'int' });
        const segments = parseOperationDescription({
            description: 'pay { amount } (yes, { amount })',
            args: [amount],
        });
        expect(segments.filter(s => s.type === 'arg')).toHaveLength(2);
        expect(segments.at(-1)).toEqual({ type: 'text', text: ')' });
    });
});

describe('formatScalarArgValue', () => {
    it('returns undefined for empty values', () => {
        expect(formatScalarArgValue(argDef({ type: 'int' }), '')).toBeUndefined();
        expect(formatScalarArgValue(argDef({ type: 'int' }), undefined)).toBeUndefined();
    });

    it('divides currency ints by the precision factor', () => {
        const arg = argDef({ type: 'int', ui: { component: 'currency-form-input' } });
        expect(formatScalarArgValue(arg, '1050')).toBe('10.5');
        expect(formatScalarArgValue(arg, '1050', 0)).toBe('1050');
    });

    it('passes plain values through', () => {
        expect(formatScalarArgValue(argDef({ type: 'int' }), '5')).toBe('5');
        expect(formatScalarArgValue(argDef({ type: 'string' }), 'abc')).toBe('abc');
    });
});

describe('descriptionIncludesAdjacentAffix', () => {
    it('detects affixes already adjacent to a placeholder', () => {
        expect(descriptionIncludesAdjacentAffix('Discount by $ ', '$', 'before')).toBe(true);
        expect(descriptionIncludesAdjacentAffix('% discount', '%', 'after')).toBe(true);
    });

    it('does not match affixes elsewhere in the surrounding text', () => {
        expect(descriptionIncludesAdjacentAffix('$ discount by ', '$', 'before')).toBe(false);
        expect(descriptionIncludesAdjacentAffix(' discount (%)', '%', 'after')).toBe(false);
    });
});
