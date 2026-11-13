import { getConfig } from '@vendure/core';
import { z } from 'zod';

/**
 * @description
 * A Zod schema for a Vendure entity ID. It accepts a string or a number, because the
 * project's ID strategy decides which one an ID is. With an auto-increment ID strategy, a string
 * of digits such as `"9"` becomes the number `9`, because core services expect a number.
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
 * @docsCategory mcp-sdk
 * @since 3.8.0
 */
export const idSchema = z
    .union([z.string(), z.number()], {
        error: 'must be a Vendure entity id (a string or a number)',
    })
    .overwrite(id => {
        if (typeof id !== 'string' || !/^\d+$/.test(id) || !Number.isSafeInteger(+id)) {
            return id;
        }
        // A Zod schema cannot inject ConfigService, so it reads the active config. getConfig() returns
        // undefined in a test runtime that cannot load the default config.
        const config = getConfig();
        const strategy = config?.entityOptions?.entityIdStrategy ?? config?.entityIdStrategy;
        return strategy?.primaryKeyType === 'increment' ? +id : id;
    });

/**
 * @description
 * The most IDs one input list should hold: 100. Use it as the `.max()` of an ID array.
 *
 * @docsCategory mcp-sdk
 * @since 3.8.0
 */
export const MAX_ID_LIST_LENGTH = 100;
