import { OrderListOptions, SortOrder } from '@vendure/common/lib/generated-types';
import {
    EntityNotFoundError,
    ID,
    Order,
    OrderService,
    RelationPaths,
    RequestContext,
    TranslatorService,
} from '@vendure/core';
import { z } from 'zod';

import { type ListInput, listOptions } from './list-helpers';

// Kept to the fields an operations user actually asks for, to keep the tool's input small.
export const ORDER_SORT_FIELDS = ['orderPlacedAt', 'updatedAt', 'createdAt', 'total'] as const;

type OrderSortField = (typeof ORDER_SORT_FIELDS)[number];

/** The two sort directions list_orders accepts; the tool adds its own description. */
export const sortDirection = z.enum(['ASC', 'DESC']);

export function orderListOptions(
    input: ListInput & { sortBy?: OrderSortField; sortDirection?: z.infer<typeof sortDirection> },
    defaultSort: OrderSortField,
): OrderListOptions {
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

// Called at the top of a tool so a missing order is refused before any work starts.
export async function findOrderOrThrow(
    orderService: OrderService,
    ctx: RequestContext,
    id: ID,
    relations: RelationPaths<Order>,
): Promise<Order> {
    const order = await orderService.findOne(ctx, id, relations);
    if (!order) {
        throw new EntityNotFoundError('Order', id);
    }
    return order;
}

export function translateLineVariants(orders: Order[], translator: TranslatorService, ctx: RequestContext) {
    for (const order of orders) {
        for (const line of order.lines) {
            line.productVariant = translator.translate(line.productVariant, ctx);
        }
    }
}
