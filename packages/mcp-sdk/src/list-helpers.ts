import { SortOrder } from '@vendure/common/lib/generated-types';
import type { ListQueryOptions, VendureEntity } from '@vendure/core';
import { z } from 'zod';

import { int32Schema } from './int32-schema';
import { shortText } from './string-schemas';

/**
 * @description
 * The paging and filter fields of a list tool's input, which {@link listOptions} and
 * {@link slicePage} read.
 *
 * @docsCategory mcp-sdk
 * @since 3.8.0
 */
export interface ListInput {
    limit?: number;
    offset?: number;
    filter?: Record<string, unknown>;
}

/**
 * @description
 * Builds the result a list tool returns: `{ items, total, hasMore }`. `total` counts the
 * matches on all pages. `hasMore` is true when more items follow this page.
 *
 * @example
 * ```ts
 * import { Injectable } from '\@nestjs/common';
 * import { Customer, CustomerService, Permission, RequestContext } from '\@vendure/core';
 * import { listOptions, McpTool, McpToolHandler, page, paginationFields } from '\@vendure/mcp-sdk';
 * import { z } from 'zod';
 *
 * const listCustomersInput = z.strictObject({ ...paginationFields('customers') });
 * type ListCustomersInput = z.infer<typeof listCustomersInput>;
 *
 * \@McpTool({
 *     name: 'list_customers',
 *     toolset: 'admin',
 *     description: 'List customer records.',
 *     permissions: [Permission.ReadCustomer],
 *     behavior: 'readonly',
 *     inputSchema: listCustomersInput,
 * })
 * \@Injectable()
 * export class ListCustomersTool implements McpToolHandler<ListCustomersInput> {
 *     constructor(private readonly customerService: CustomerService) {}
 *
 *     async execute(ctx: RequestContext, input: ListCustomersInput) {
 *         const result = await this.customerService.findAll(ctx, listOptions<Customer>(input));
 *         return page(
 *             result.items.map(customer => ({ id: customer.id, emailAddress: customer.emailAddress })),
 *             result.totalItems,
 *             input,
 *         );
 *     }
 * }
 * ```
 *
 * @docsCategory mcp-sdk
 * @since 3.8.0
 */
export function page<T>(
    items: T[],
    totalItems: number,
    input: { offset?: number },
): { items: T[]; total: number; hasMore: boolean } {
    const offset = input.offset ?? 0;
    // `total` deliberately renames Vendure's `totalItems`.
    return { items, total: totalItems, hasMore: offset + items.length < totalItems };
}

const DEFAULT_LIST_PAGE_SIZE = 25;

/**
 * @description
 * The largest `limit` that {@link paginationFields} accepts: 100.
 *
 * @docsCategory mcp-sdk
 * @since 3.8.0
 */
export const MAX_LIST_PAGE_SIZE = 100;

/**
 * @description
 * Returns the `limit` and `offset` input fields of a list tool, to spread into a Zod object.
 * `limit` accepts 1 to {@link MAX_LIST_PAGE_SIZE} and defaults to 25. `noun` names the items
 * in the field descriptions, such as "customers". See {@link page} for an example.
 *
 * @docsCategory mcp-sdk
 * @since 3.8.0
 */
export function paginationFields(noun: string): {
    limit: z.ZodOptional<z.ZodNumber>;
    offset: z.ZodOptional<z.ZodNumber>;
} {
    return {
        limit: z
            .number()
            .int()
            .min(1)
            .max(MAX_LIST_PAGE_SIZE)
            .describe(
                `Maximum number of ${noun} to return, 1 to ${MAX_LIST_PAGE_SIZE}. ` +
                    `Defaults to ${DEFAULT_LIST_PAGE_SIZE}.`,
            )
            .optional(),
        offset: int32Schema.min(0).describe(`Number of ${noun} to skip.`).optional(),
    };
}

const isoDate = z.iso.datetime({ offset: true }).transform(value => new Date(value));

// Upper bound on the values one `in` filter may list, so a runaway list cannot become a huge query.
const MAX_FILTER_VALUES = 100;

/**
 * @description
 * A Zod schema for filtering a string field in a list tool. It takes `eq`, `contains`, and
 * `in` with up to 100 values. Each value is at most 255 characters.
 *
 * @docsCategory mcp-sdk
 * @since 3.8.0
 */
export const stringFilter = z.strictObject({
    eq: shortText.describe('Exact match.').optional(),
    contains: shortText
        .describe(
            "Substring match. Case-insensitive on Postgres, otherwise follows the database's collation.",
        )
        .optional(),
    in: z.array(shortText).max(MAX_FILTER_VALUES).describe('Any of these exact values.').optional(),
});

/**
 * @description
 * A Zod schema for filtering a date field in a list tool. It takes `before` and `after` as
 * ISO 8601 date-times and parses them into `Date` objects, which Vendure's list queries need.
 *
 * @docsCategory mcp-sdk
 * @since 3.8.0
 */
export const dateFilter = z.strictObject({
    before: isoDate.describe('ISO 8601 date-time, exclusive.').optional(),
    after: isoDate.describe('ISO 8601 date-time, exclusive.').optional(),
});

/**
 * @description
 * A Zod schema for filtering a number field in a list tool. It takes `eq`, `gte` and `lte`.
 *
 * @docsCategory mcp-sdk
 * @since 3.8.0
 */
export const numberFilter = z.strictObject({
    eq: z.number().optional(),
    gte: z.number().optional(),
    lte: z.number().optional(),
});

/**
 * @description
 * A Zod schema for filtering a boolean field in a list tool. It takes `eq`.
 *
 * @docsCategory mcp-sdk
 * @since 3.8.0
 */
export const booleanFilter = z.strictObject({ eq: z.boolean().optional() });

/**
 * @description
 * Returns one page of an in-memory array, using the input's `offset` and `limit`. The page
 * size defaults to 25. Pass the array's length to {@link page} as the total.
 *
 * @docsCategory mcp-sdk
 * @since 3.8.0
 */
export function slicePage<T>(all: T[], input: ListInput): T[] {
    const offset = input.offset ?? 0;
    return all.slice(offset, offset + (input.limit ?? DEFAULT_LIST_PAGE_SIZE));
}

/**
 * @description
 * Turns a list tool's input into the `ListQueryOptions` that Vendure's `findAll` methods take.
 * It sorts the newest items first. See {@link page} for an example.
 *
 * @docsCategory mcp-sdk
 * @since 3.8.0
 */
export function listOptions<T extends VendureEntity>(input: ListInput): ListQueryOptions<T> {
    return {
        take: input.limit ?? DEFAULT_LIST_PAGE_SIZE,
        skip: input.offset ?? 0,
        ...(input.filter ? { filter: input.filter as ListQueryOptions<T>['filter'] } : {}),
        sort: { createdAt: SortOrder.DESC, id: SortOrder.DESC } as ListQueryOptions<T>['sort'],
    };
}
