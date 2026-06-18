import { ConfigurableOperationDefinition } from '../generated-types';

import { interpolateDescription } from './interpolate-description';

describe('interpolateDescription()', () => {
    it('works for single argument', () => {
        const operation: Partial<ConfigurableOperationDefinition> = {
            args: [{ name: 'foo', type: 'string', list: false, required: false }],
            description: 'The value is { foo }',
        };
        const result = interpolateDescription(operation as any, { foo: 'val' });

        expect(result).toBe('The value is val');
    });

    it('works for multiple arguments', () => {
        const operation: Partial<ConfigurableOperationDefinition> = {
            args: [
                { name: 'foo', type: 'string', list: false, required: false },
                { name: 'bar', type: 'string', list: false, required: false },
            ],
            description: 'The value is { foo } and { bar }',
        };
        const result = interpolateDescription(operation as any, { foo: 'val1', bar: 'val2' });

        expect(result).toBe('The value is val1 and val2');
    });

    it('is case-insensitive', () => {
        const operation: Partial<ConfigurableOperationDefinition> = {
            args: [{ name: 'foo', type: 'string', list: false, required: false }],
            description: 'The value is { FOo }',
        };
        const result = interpolateDescription(operation as any, { foo: 'val' });

        expect(result).toBe('The value is val');
    });

    it('ignores whitespaces in interpolation', () => {
        const operation: Partial<ConfigurableOperationDefinition> = {
            args: [
                { name: 'foo', type: 'string', list: false, required: false },
                { name: 'bar', type: 'string', list: false, required: false },
            ],
            description: 'The value is {foo} and {      bar    }',
        };
        const result = interpolateDescription(operation as any, { foo: 'val1', bar: 'val2' });

        expect(result).toBe('The value is val1 and val2');
    });

    it('formats currency-form-input value as a decimal', () => {
        const operation: Partial<ConfigurableOperationDefinition> = {
            args: [
                {
                    name: 'price',
                    type: 'int',
                    list: false,
                    ui: { component: 'currency-form-input' },
                    required: false,
                },
            ],
            description: 'The price is { price }',
        };
        const result = interpolateDescription(operation as any, { price: 1234 });

        expect(result).toBe('The price is 12.34');
    });

    it('formats Date object as human-readable', () => {
        const operation: Partial<ConfigurableOperationDefinition> = {
            args: [{ name: 'date', type: 'datetime', list: false, required: false }],
            description: 'The date is { date }',
        };
        const date = new Date('2017-09-15 00:00:00');
        const result = interpolateDescription(operation as any, { date });

        expect(result).toBe(`The date is ${date.toLocaleDateString()}`);
    });

    it('formats date string object as human-readable', () => {
        const operation: Partial<ConfigurableOperationDefinition> = {
            args: [{ name: 'date', type: 'datetime', list: false, required: false }],
            description: 'The date is { date }',
        };
        const date = '2017-09-15';
        const result = interpolateDescription(operation as any, { date });

        expect(result).toBe(`The date is 2017-09-15`);
    });

    it('correctly interprets falsy-looking values', () => {
        const operation: Partial<ConfigurableOperationDefinition> = {
            args: [{ name: 'foo', type: 'int', list: false, required: false }],
            description: 'The value is { foo }',
        };
        const result = interpolateDescription(operation as any, { foo: 0 });

        expect(result).toBe(`The value is 0`);
    });
});
