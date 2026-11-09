import { shortText } from '@vendure/mcp-sdk';
import { z } from 'zod';

export const addressInputSchema = z.strictObject({
    fullName: shortText.optional(),
    company: shortText.optional(),
    streetLine1: shortText,
    streetLine2: shortText.optional(),
    city: shortText.optional(),
    province: shortText.optional(),
    postalCode: shortText.optional(),
    countryCode: shortText,
    phoneNumber: shortText.optional(),
    defaultShippingAddress: z.boolean().optional(),
    defaultBillingAddress: z.boolean().optional(),
    customFields: z.looseObject({}).describe('Address custom fields.').optional(),
});
