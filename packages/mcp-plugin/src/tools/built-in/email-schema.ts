import { z } from 'zod';

// `meta` just tells the client what the field holds; `refine` is what actually rejects a bad value.
export const emailAddressSchema = z
    .string()
    .max(255)
    .describe('Customer email address.')
    .meta({ format: 'email' })
    .refine(value => z.regexes.email.test(value), 'Invalid email address');
