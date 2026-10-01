import { z } from 'zod';

/**
 * @description
 * A Zod schema for a Vendure entity ID. It accepts a string or a number, because the
 * project's ID strategy decides which one an ID is.
 *
 * @example
 * ```ts
 * import { idSchema, MAX_ID_LIST_LENGTH } from '\@vendure/mcp-sdk';
 * import { z } from 'zod';
 *
 * const input = z.strictObject({
 *     productId: idSchema.describe('The product to update.'),
 *     assetIds: z.array(idSchema).max(MAX_ID_LIST_LENGTH).optional(),
 * });
 * ```
 *
 * @docsCategory core plugins/McpPlugin
 * @since 3.8.0
 */
export const idSchema = z.union([z.string(), z.number()], {
    error: 'must be a Vendure entity id (a string or a number)',
});

/**
 * @description
 * The most IDs one input list should hold: 100. Use it as the `.max()` of an ID array.
 *
 * @docsCategory core plugins/McpPlugin
 * @since 3.8.0
 */
export const MAX_ID_LIST_LENGTH = 100;
