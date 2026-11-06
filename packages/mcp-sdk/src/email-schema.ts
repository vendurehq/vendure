import { z } from 'zod';

/**
 * @description
 * A Zod schema for a customer email address of at most 255 characters. It refuses a value
 * that is not a valid email address.
 *
 * @docsCategory mcp-sdk
 * @since 3.8.0
 */
export const emailAddressSchema = z
    .string()
    .max(255)
    .describe('Customer email address.')
    // `meta` only tells the client what the field holds; `refine` is what rejects a bad value.
    .meta({ format: 'email' })
    .refine(value => z.regexes.email.test(value), 'Invalid email address');
