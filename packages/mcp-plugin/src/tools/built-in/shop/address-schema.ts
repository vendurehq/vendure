import { z } from 'zod';

import { shortText } from '../string-schemas';

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
