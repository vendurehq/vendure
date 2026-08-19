import { OrderListOptions, SortOrder } from '@vendure/common/lib/generated-types';
import { Collection, ListQueryOptions, Product, VendureEntity } from '@vendure/core';
import { z } from 'zod';

/** Common pagination fields shared by the list tool inputs (already validated by the tool schema). */
interface ListInput {
    limit?: number;
    offset?: number;
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

/**
 * Trims a plural ending off a word. Only characters at the end are removed, and product matching
 * is substring-based, so the trimmed word always finds everything the original word would find.
 * Words under four characters are left alone so that "gas" or "bus" are not mangled.
 */
function singular(word: string): string {
    if (word.length < 4) {
        return word;
    }
    // English adds "es" rather than "s" after s, x, z, ch and sh: boxes, watches, dresses, lenses.
    if (/(?:s|x|z|ch|sh)es$/i.test(word)) {
        return word.slice(0, -2);
    }
    // A plain plural "s", but not a word that ends in "ss" of its own accord, such as "glass".
    if (/[^s]s$/i.test(word)) {
        return word.slice(0, -1);
    }
    return word;
}

/**
 * Splits a search query into the words a product has to match. Pass `trimPlurals` to get the words
 * with their plural endings removed; `search_products` uses that as a second attempt when the words
 * as the shopper typed them find nothing.
 */
export function productSearchWords(query: string | undefined, trimPlurals = false): string[] {
    const words = (query ?? '')
        .trim()
        .split(/\s+/)
        .filter(word => word.length > 0);
    return trimPlurals ? words.map(singular) : words;
}

/**
 * Builds the query for a public product search: only enabled products, and every word has to turn
 * up in the product's name or slug, in any order. Descriptions are not searched.
 */
export function publicProductListOptions(input: ListInput, words: string[] = []): ListQueryOptions<Product> {
    const options = listOptions<Product>(input);
    const wordFilters = words.map(word => ({
        _or: [{ name: { contains: word } }, { slug: { contains: word } }],
    }));
    return {
        ...options,
        filter: {
            enabled: { eq: true },
            ...(wordFilters.length ? { _and: wordFilters } : {}),
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
