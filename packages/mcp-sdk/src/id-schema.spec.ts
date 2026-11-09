import { resetConfig, setConfig, UuidIdStrategy } from '@vendure/core';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { idSchema } from './id-schema';

describe('idSchema', () => {
    afterEach(() => resetConfig());

    it('accepts a string or a number', () => {
        expect(idSchema.parse('T_1')).toBe('T_1');
        expect(idSchema.parse(1)).toBe(1);
    });

    it('converts a string of digits to a number', () => {
        expect(idSchema.parse('9')).toBe(9);
        expect(idSchema.describe('Variant ID.').parse('9')).toBe(9);
        expect(z.array(idSchema).parse(['1', 2, 'T_3'])).toEqual([1, 2, 'T_3']);
    });

    it('keeps a string of digits too large for a safe integer', () => {
        expect(idSchema.parse('99999999999999999999')).toBe('99999999999999999999');
    });

    it('keeps a string of digits with a uuid ID strategy', async () => {
        await setConfig({ entityOptions: { entityIdStrategy: new UuidIdStrategy() } });
        expect(idSchema.parse('9')).toBe('9');
    });

    it('refuses any other value with a message naming what it expects', () => {
        const result = idSchema.safeParse(true);
        expect(result.success).toBe(false);
        expect(result.error?.issues[0].message).toBe('must be a Vendure entity id (a string or a number)');
    });
});
