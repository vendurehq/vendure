// Helpers shared by the tools that list or load Orders.
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

/**
 * The Order fields `list_orders` can sort by. Kept to the few an operations user asks for, so the
 * tool's input stays small: when an order happened, when it last changed, and how big it is.
 */
export const ORDER_SORT_FIELDS = ['orderPlacedAt', 'updatedAt', 'createdAt', 'total'] as const;

export type OrderSortField = (typeof ORDER_SORT_FIELDS)[number];

/** The two sort directions list_orders accepts; the tool adds its own description. */
export const sortDirection = z.enum(['ASC', 'DESC']);

interface OrderListInput extends ListInput {
    sortBy?: OrderSortField;
    sortDirection?: z.infer<typeof sortDirection>;
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

/**
 * Loads one Order by id for an admin tool, or throws the same "not found" error core would.
 * Tools call this at the top so a missing order is refused before any work starts.
 */
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
