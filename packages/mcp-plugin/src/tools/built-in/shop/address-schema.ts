import { z } from 'zod';

export const addressInputSchema = z.strictObject({
    fullName: z.string().optional(),
    company: z.string().optional(),
    streetLine1: z.string(),
    streetLine2: z.string().optional(),
    city: z.string().optional(),
    province: z.string().optional(),
    postalCode: z.string().optional(),
    countryCode: z.string(),
    phoneNumber: z.string().optional(),
    defaultShippingAddress: z.boolean().optional(),
    defaultBillingAddress: z.boolean().optional(),
    customFields: z.looseObject({}).describe('Address custom fields.').optional(),
});
