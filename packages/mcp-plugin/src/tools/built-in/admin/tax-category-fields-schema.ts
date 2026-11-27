import { shortText } from '@vendure/mcp-sdk';
import { z } from 'zod';

/** Fields shared by create_tax_category and update_tax_category. Update makes them optional. */
export const taxCategoryFieldsSchema = z.strictObject({
    name: shortText.describe('Tax category name, e.g. "Standard".'),
    isDefault: z.boolean().describe('Make this the default category for new product variants.').optional(),
});
