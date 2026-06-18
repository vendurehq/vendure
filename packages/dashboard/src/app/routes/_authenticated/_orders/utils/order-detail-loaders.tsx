import { addCustomFields } from '@/vdb/framework/document-introspection/add-custom-fields.js';
import { getDetailQueryOptions } from '@/vdb/framework/page/use-detail-page.js';
import { ResultOf } from '@/vdb/graphql/graphql.js';
import { Trans } from '@lingui/react/macro';
import { redirect } from '@tanstack/react-router';
import { OrderDetail } from '../components/order-detail-shared.js';
import { orderDetailDocument } from '../orders.graphql.js';

async function ensureOrderWithIdExists(context: any, params: { id: string }): Promise<OrderDetail> {
    if (!params.id) {
        throw new Error('ID param is required');
    }

    const result: ResultOf<typeof orderDetailDocument> = await context.queryClient.ensureQueryData(
        getDetailQueryOptions(
            addCustomFields(orderDetailDocument, { includeNestedFragments: ['OrderLine', 'Fulfillment'] }),
            { id: params.id },
        ),
    );

    if (!result.order) {
        throw new Error(`Order with the ID ${params.id} was not found`);
    }
    return result.order;
}

export async function commonRegularOrderLoader(context: any, params: { id: string }): Promise<OrderDetail> {
    const order = await ensureOrderWithIdExists(context, params);

    if (order.state === 'Draft') {
        throw redirect({
            to: `/orders/draft/${params.id}`,
        });
    }
    return order;
}

export async function loadRegularOrder(context: any, params: { id: string }) {
    const order = await commonRegularOrderLoader(context, params);

    if (order.state === 'Modifying') {
        throw redirect({
            to: `/orders/${params.id}/modify`,
        });
    }

    return {
        breadcrumb: [{ path: '/orders', label: <Trans>Orders</Trans> }, order.code],
    };
}

export async function loadDraftOrder(context: any, params: { id: string }) {
    const order = await ensureOrderWithIdExists(context, params);

    if (order.state !== 'Draft') {
        throw redirect({
            to: `/orders/${params.id}`,
        });
    }

    return {
        breadcrumb: [{ path: '/orders', label: <Trans>Orders</Trans> }, order.code],
    };
}

export async function loadModifyingOrder(context: any, params: { id: string }) {
    const order = await commonRegularOrderLoader(context, params);
    if (order.state !== 'Modifying') {
        throw redirect({
            to: `/orders/${params.id}`,
        });
    }

    return {
        breadcrumb: [
            { path: '/orders', label: <Trans>Orders</Trans> },
            order.code,
            { label: <Trans>Modify</Trans> },
        ],
    };
}

export async function loadSellerOrder(
    context: any,
    params: { aggregateOrderId: string; sellerOrderId: string },
) {
    if (!params.sellerOrderId || !params.aggregateOrderId) {
        throw new Error('Both seller order ID and aggregate order ID params are required');
    }

    const result: ResultOf<typeof orderDetailDocument> = await context.queryClient.ensureQueryData(
        getDetailQueryOptions(
            addCustomFields(orderDetailDocument, { includeNestedFragments: ['OrderLine', 'Fulfillment'] }),
            { id: params.sellerOrderId },
        ),
    );

    if (!result.order) {
        throw new Error(`Seller order with the ID ${params.sellerOrderId} was not found`);
    }

    // Verify this is actually a seller order by checking if it has an aggregateOrder
    if (!result.order.aggregateOrder) {
        throw new Error(`Order ${params.sellerOrderId} is not a seller order`);
    }

    // Verify the aggregate order ID matches
    if (result.order.aggregateOrder.id !== params.aggregateOrderId) {
        throw new Error(
            `Seller order ${params.sellerOrderId} does not belong to aggregate order ${params.aggregateOrderId}`,
        );
    }

    if (result.order.state === 'Draft') {
        throw redirect({
            to: `/orders/draft/${params.sellerOrderId}`,
        });
    }

    if (result.order.state === 'Modifying') {
        throw redirect({
            to: `/orders/${params.sellerOrderId}/modify`,
        });
    }

    return {
        breadcrumb: [
            { path: '/orders', label: <Trans>Orders</Trans> },
            {
                path: `/orders/${params.aggregateOrderId}`,
                label: result.order.aggregateOrder.code,
            },
            {
                path: `/orders/${params.aggregateOrderId}`,
                label: 'Seller orders',
            },
            result.order.code,
        ],
    };
}
