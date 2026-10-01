import { describe, expect, it } from 'vitest';

import { emailAddressSchema } from './email-schema';

describe('emailAddressSchema', () => {
    it('accepts a valid email address', () => {
        expect(emailAddressSchema.parse('jane@example.test')).toBe('jane@example.test');
    });

    it('refuses an invalid email address', () => {
        const result = emailAddressSchema.safeParse('not-an-email');
        expect(result.success).toBe(false);
        expect(result.error?.issues[0].message).toBe('Invalid email address');
    });

    it('refuses an address longer than 255 characters', () => {
        expect(emailAddressSchema.safeParse(`${'a'.repeat(250)}@example.test`).success).toBe(false);
    });
});
