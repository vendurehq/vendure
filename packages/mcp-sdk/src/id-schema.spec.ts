import { describe, expect, it } from 'vitest';

import { idSchema } from './id-schema';

describe('idSchema', () => {
    it('accepts a string or a number', () => {
        expect(idSchema.parse('T_1')).toBe('T_1');
        expect(idSchema.parse(1)).toBe(1);
    });

    it('refuses any other value with a message naming what it expects', () => {
        const result = idSchema.safeParse(true);
        expect(result.success).toBe(false);
        expect(result.error?.issues[0].message).toBe('must be a Vendure entity id (a string or a number)');
    });
});
