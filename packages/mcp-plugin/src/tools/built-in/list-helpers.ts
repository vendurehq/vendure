import { SortOrder } from '@vendure/common/lib/generated-types';
import { ListQueryOptions, VendureEntity } from '@vendure/core';
import { z } from 'zod';

import { int32Schema } from './int32-schema';
import { shortText } from './string-schemas';

/** Common pagination fields shared by the list tool inputs (already validated by the tool schema). */
export interface ListInput {
    limit?: number;
    offset?: number;
    filter?: Record<string, unknown>;
}

/** The list envelope every list tool returns; `total` deliberately renames Vendure's `totalItems`. */
export function page<T>(items: T[], totalItems: number, input: { offset?: number }) {
    const offset = input.offset ?? 0;
    return { items, total: totalItems, hasMore: offset + items.length < totalItems };
}

const DEFAULT_LIST_PAGE_SIZE = 25;

export const MAX_LIST_PAGE_SIZE = 100;

export function paginationFields(noun: string) {
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

export const stringFilter = z.strictObject({
    eq: shortText.describe('Exact match.').optional(),
    contains: shortText
        .describe(
            "Substring match. Case-insensitive on Postgres, otherwise follows the database's collation.",
        )
        .optional(),
    in: z.array(shortText).max(MAX_FILTER_VALUES).describe('Any of these exact values.').optional(),
});

export const dateFilter = z.strictObject({
    before: isoDate.describe('ISO 8601 date-time, exclusive.').optional(),
    after: isoDate.describe('ISO 8601 date-time, exclusive.').optional(),
});

export const numberFilter = z.strictObject({
    eq: z.number().optional(),
    gte: z.number().optional(),
    lte: z.number().optional(),
});

export const booleanFilter = z.strictObject({ eq: z.boolean().optional() });

export function slicePage<T>(all: T[], input: ListInput): T[] {
    const offset = input.offset ?? 0;
    return all.slice(offset, offset + (input.limit ?? DEFAULT_LIST_PAGE_SIZE));
}

export function listOptions<T extends VendureEntity>(input: ListInput): ListQueryOptions<T> {
    return {
        take: input.limit ?? DEFAULT_LIST_PAGE_SIZE,
        skip: input.offset ?? 0,
        ...(input.filter ? { filter: input.filter as ListQueryOptions<T>['filter'] } : {}),
        sort: { createdAt: SortOrder.DESC, id: SortOrder.DESC } as ListQueryOptions<T>['sort'],
    };
}
