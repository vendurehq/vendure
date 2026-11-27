import { shortText } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { configurableOperationSchema, methodTranslationsSchema } from './setup-schemas';

/** Fields shared by create_shipping_method and update_shipping_method. Update makes them optional. */
export const shippingMethodFieldsSchema = z.strictObject({
    code: shortText.describe('Unique code, e.g. "standard-shipping".'),
    fulfillmentHandler: shortText.describe(
        'Code of the fulfillment handler, from list_shipping_options, e.g. "manual-fulfillment".',
    ),
    checker: configurableOperationSchema.describe(
        'The eligibility checker that decides which orders can use the method.',
    ),
    calculator: configurableOperationSchema.describe('The calculator that prices the shipping.'),
    translations: methodTranslationsSchema,
});
