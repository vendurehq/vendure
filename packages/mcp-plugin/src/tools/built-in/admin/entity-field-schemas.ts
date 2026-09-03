import { GlobalFlag } from '@vendure/common/lib/generated-types';
import { z } from 'zod';

import { emailAddressSchema } from '../email-schema';
import { idSchema, MAX_ID_LIST_LENGTH } from '../id-schema';
import { int32Schema } from '../int32-schema';
import { shortText } from '../string-schemas';

/**
 * Fields shared by create_customer and update_customer. create uses them as is; update makes them all
 * optional.
 */
export const customerFieldsSchema = z.strictObject({
    firstName: shortText.describe('Customer first name.'),
    lastName: shortText.describe('Customer last name.'),
    emailAddress: emailAddressSchema,
    phoneNumber: shortText.describe('Customer phone number.').optional(),
    title: shortText.describe('Customer title, e.g. "Mr" or "Ms".').optional(),
    customFields: z.looseObject({}).describe('Customer custom fields.').optional(),
});

/** Fields shared by create_product and update_product. Each tool adds its own `translations`. */
export const productFieldsSchema = z.strictObject({
    enabled: z.boolean().describe('Whether the product is enabled.').optional(),
    facetValueIds: z
        .array(idSchema.describe('Vendure ID.'))
        .max(MAX_ID_LIST_LENGTH)
        .describe('Facet value IDs to assign.')
        .optional(),
    assetIds: z
        .array(idSchema.describe('Vendure ID.'))
        .max(MAX_ID_LIST_LENGTH)
        .describe('Asset IDs to attach.')
        .optional(),
    featuredAssetId: idSchema.describe('Featured asset ID.').optional(),
    customFields: z.looseObject({}).describe('Product custom fields.').optional(),
});

/**
 * Fields shared by create_variant and update_variant. Each tool adds `sku` and `translations`; create
 * also adds `stockOnHand`.
 */
export const variantFieldsSchema = z.strictObject({
    price: int32Schema.min(0).describe('Price as a whole number of minor units, e.g. cents.').optional(),
    optionIds: z
        .array(idSchema.describe('Vendure ID.'))
        .max(MAX_ID_LIST_LENGTH)
        .describe('Product option IDs for this variant.')
        .optional(),
    taxCategoryId: idSchema.describe('Tax category ID.').optional(),
    featuredAssetId: idSchema.describe('Featured asset ID.').optional(),
    assetIds: z
        .array(idSchema.describe('Vendure ID.'))
        .max(MAX_ID_LIST_LENGTH)
        .describe('Asset IDs to attach.')
        .optional(),
    trackInventory: z
        .enum(GlobalFlag)
        .describe('Inventory tracking: "TRUE", "FALSE", or "INHERIT".')
        .optional(),
    enabled: z.boolean().describe('Whether the variant is enabled.').optional(),
    customFields: z.looseObject({}).describe('Variant custom fields.').optional(),
});
