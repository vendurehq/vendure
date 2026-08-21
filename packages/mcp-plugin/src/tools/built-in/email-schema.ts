import { z } from 'zod';

// `meta` puts `format: 'email'` in the published JSON schema so a client can see what the field
// holds; the refine is what rejects a bad value on the server.
export const emailAddressSchema = z
    .string()
    .describe('Customer email address.')
    .meta({ format: 'email' })
    .refine(value => z.regexes.email.test(value), 'Invalid email address');
