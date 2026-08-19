import { OrderListOptions, SortOrder } from '@vendure/common/lib/generated-types';
import { Collection, ListQueryOptions, Product, VendureEntity } from '@vendure/core';
import { z } from 'zod';

/** Common pagination fields shared by the list tool inputs (already validated by the tool schema). */
interface ListInput {
    limit?: number;
    offset?: number;
}

interface ProductListInput extends ListInput {
    query?: string;
}

/** The list envelope every list tool returns; `total` deliberately renames Vendure's `totalItems`. */
export function page<T>(items: T[], totalItems: number, input: { offset?: number }) {
    const offset = input.offset ?? 0;
    return { items, total: totalItems, hasMore: offset + items.length < totalItems };
}

const DEFAULT_LIST_PAGE_SIZE = 25;

export function paginationFields(noun: string) {
    return {
        limit: z.number().describe(`Maximum number of ${noun} to return.`).optional(),
        offset: z.number().describe(`Number of ${noun} to skip.`).optional(),
    };
}

export function slicePage<T>(all: T[], input: ListInput): T[] {
    const offset = input.offset ?? 0;
    return all.slice(offset, offset + (input.limit ?? DEFAULT_LIST_PAGE_SIZE));
}

export function listOptions<T extends VendureEntity>(input: ListInput): ListQueryOptions<T> {
    return {
        take: input.limit ?? DEFAULT_LIST_PAGE_SIZE,
        skip: input.offset ?? 0,
    } as ListQueryOptions<T>;
}

function productListOptions(input: ProductListInput): ListQueryOptions<Product> {
    const options = listOptions<Product>(input);
    const query = (input.query ?? '').trim();
    if (!query) {
        return options;
    }
    return {
        ...options,
        filter: {
            _or: [{ name: { contains: query } }, { slug: { contains: query } }],
        },
    } as ListQueryOptions<Product>;
}

export function publicProductListOptions(input: ProductListInput): ListQueryOptions<Product> {
    const options = productListOptions(input);
    return {
        ...options,
        filter: {
            ...options.filter,
            enabled: { eq: true },
        },
    } as ListQueryOptions<Product>;
}

export function publicCollectionListOptions(input: ListInput): ListQueryOptions<Collection> {
    const options = listOptions<Collection>(input);
    return {
        ...options,
        filter: {
            ...options.filter,
            isPrivate: { eq: false },
        },
    } as ListQueryOptions<Collection>;
}

/**
 * The Order fields `list_orders` can sort by. Kept to the few an operations user asks for, so the
 * tool's input stays small: when an order happened, when it last changed, and how big it is.
 */
export const ORDER_SORT_FIELDS = ['orderPlacedAt', 'updatedAt', 'createdAt', 'total'] as const;

export type OrderSortField = (typeof ORDER_SORT_FIELDS)[number];

interface OrderListInput extends ListInput {
    sortBy?: OrderSortField;
    sortDirection?: 'ASC' | 'DESC';
}

export function orderListOptions(input: OrderListInput): OrderListOptions {
    const field = input.sortBy ?? 'orderPlacedAt';
    const direction = input.sortDirection === 'ASC' ? SortOrder.ASC : SortOrder.DESC;
    return {
        take: input.limit ?? DEFAULT_LIST_PAGE_SIZE,
        skip: input.offset ?? 0,
        // Without a sort the database returns rows in no defined order, so asking for "the recent
        // orders" would get an arbitrary page. Newest placed first is what an operations user means.
        sort: { [field]: direction },
    };
}
