import { describe, expect, it } from 'vitest';

import { toConfigurableOperationInput } from './setup-schemas';

describe('toConfigurableOperationInput', () => {
    it('passes strings as they are and sends every other value as JSON', () => {
        expect(
            toConfigurableOperationInput({
                code: 'default-shipping-calculator',
                args: { rate: 500, includesTax: 'auto', enabled: true, codes: ['a', 'b'] },
            }),
        ).toEqual({
            code: 'default-shipping-calculator',
            arguments: [
                { name: 'rate', value: '500' },
                { name: 'includesTax', value: 'auto' },
                { name: 'enabled', value: 'true' },
                { name: 'codes', value: '["a","b"]' },
            ],
        });
    });

    it('sends null as the empty string, which core treats as unset', () => {
        expect(toConfigurableOperationInput({ code: 'card', args: { accountId: null } }).arguments).toEqual([
            { name: 'accountId', value: '' },
        ]);
    });

    it('sends no arguments when args is left out', () => {
        expect(toConfigurableOperationInput({ code: 'manual-fulfillment' })).toEqual({
            code: 'manual-fulfillment',
            arguments: [],
        });
    });
});
