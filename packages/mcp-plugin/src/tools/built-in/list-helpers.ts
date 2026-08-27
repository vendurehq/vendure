import { OrderListOptions, SortOrder } from '@vendure/common/lib/generated-types';
import {
    Collection,
    ListQueryOptions,
    Order,
    Product,
    RelationPaths,
    RequestContext,
    TranslatorService,
    VendureEntity,
} from '@vendure/core';
import { z } from 'zod';

/** Common pagination fields shared by the list tool inputs (already validated by the tool schema). */
interface ListInput {
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
        offset: z.number().int().min(0).describe(`Number of ${noun} to skip.`).optional(),
    };
}

const isoDate = z.iso.datetime({ offset: true }).transform(value => new Date(value));

export const stringFilter = z.strictObject({
    eq: z.string().describe('Exact match.').optional(),
    contains: z
        .string()
        .describe(
            "Substring match. Case-insensitive on Postgres, otherwise follows the database's collation.",
        )
        .optional(),
    in: z.array(z.string()).describe('Any of these exact values.').optional(),
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
    };
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
    if (/(?:s|x|z|ch|sh)es$/i.test(word)) {
        return word.slice(0, -2);
    }
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
 * up in the product's name or slug, in any order. Descriptions are not searched. When `productIds`
 * is given, only those products can match; an empty list matches nothing.
 */
export function publicProductListOptions(
    input: ListInput,
    words: string[] = [],
    productIds?: string[],
): ListQueryOptions<Product> {
    const options = listOptions<Product>({ limit: input.limit, offset: input.offset });
    const wordFilters = words.map(word => ({
        _or: [{ name: { contains: word } }, { slug: { contains: word } }],
    }));
    return {
        ...options,
        filter: {
            enabled: { eq: true },
            ...(wordFilters.length ? { _and: wordFilters } : {}),
            ...(productIds ? { id: { in: productIds } } : {}),
        },
    };
}

export function publicCollectionListOptions(input: ListInput): ListQueryOptions<Collection> {
    const options = listOptions<Collection>({ limit: input.limit, offset: input.offset });
    return {
        ...options,
        filter: {
            isPrivate: { eq: false },
        },
    };
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
        ...(listOptions<Order>(input) as OrderListOptions),
        // Without a sort the database returns rows in no defined order, so asking for "the recent
        // orders" would get an arbitrary page. Newest placed first is what an operations user means.
        sort: { [field]: direction },
    };
}

export const ORDER_LIST_RELATIONS: RelationPaths<Order> = [
    'lines',
    'lines.productVariant',
    'lines.productVariant.translations',
    'shippingLines',
    'payments',
    'payments.refunds',
    'fulfillments',
    'fulfillments.lines',
    'customer',
];

export const ORDER_DETAIL_RELATIONS: RelationPaths<Order> = [...ORDER_LIST_RELATIONS, 'customer.user'];

export function translateLineVariants(orders: Order[], translator: TranslatorService, ctx: RequestContext) {
    for (const order of orders) {
        for (const line of order.lines) {
            line.productVariant = translator.translate(line.productVariant, ctx);
        }
    }
}
