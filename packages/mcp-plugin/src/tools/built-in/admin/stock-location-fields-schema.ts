import { longText, shortText } from '@vendure/mcp-sdk';
import { z } from 'zod';

/** Fields shared by create_stock_location and update_stock_location. Update makes them optional. */
export const stockLocationFieldsSchema = z.strictObject({
    name: shortText.describe('Stock location name, e.g. "Main warehouse".'),
    description: longText.describe('Stock location description.').optional(),
});
