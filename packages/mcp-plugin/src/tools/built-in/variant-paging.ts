import { PaginatedList } from '@vendure/common/lib/shared-types';
import { int32Schema } from '@vendure/mcp-sdk';

/** The input field both get_product tools take to page through a product's variants. */
export const variantOffset = int32Schema
    .min(0)
    .describe(
        'Number of variants to skip. Use with hasMoreVariants when a product has more ' +
            'variants than one answer returns.',
    )
    .optional();

/** The two paging keys a get_product answer carries next to its `variants` array. */
export function variantPaging(offset: number, variants: PaginatedList<unknown>) {
    return {
        variantTotal: variants.totalItems,
        hasMoreVariants: offset + variants.items.length < variants.totalItems,
    };
}
