// Helpers shared by the tools that list or load Orders.
import { OrderListOptions, SortOrder } from '@vendure/common/lib/generated-types';
import { Order, RelationPaths, RequestContext, TranslatorService } from '@vendure/core';

import { type ListInput, listOptions } from './list-helpers';

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

export function orderListOptions(input: OrderListInput, defaultSort: OrderSortField): OrderListOptions {
    const field = input.sortBy ?? defaultSort;
    const direction = input.sortDirection === 'ASC' ? SortOrder.ASC : SortOrder.DESC;
    return {
        ...(listOptions<Order>(input) as OrderListOptions),
        sort: { [field]: direction, id: direction },
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
