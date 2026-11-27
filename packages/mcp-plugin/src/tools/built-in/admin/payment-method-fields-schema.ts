import { shortText } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { configurableOperationSchema, methodTranslationsSchema } from './setup-schemas';

/** Fields shared by create_payment_method and update_payment_method. Update makes them optional. */
export const paymentMethodFieldsSchema = z.strictObject({
    code: shortText.describe('Unique code, e.g. "card-payment".'),
    enabled: z
        .boolean()
        .describe('Whether customers can use the method. Defaults to true on create.')
        .optional(),
    checker: configurableOperationSchema
        .nullable()
        .describe(
            'An optional eligibility checker that decides which orders can use the method. Null removes it on update.',
        )
        .optional(),
    handler: configurableOperationSchema.describe('The payment handler that takes the payment.'),
    translations: methodTranslationsSchema,
});
