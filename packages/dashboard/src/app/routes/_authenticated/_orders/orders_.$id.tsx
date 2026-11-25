import { ErrorPage } from '@/vdb/components/shared/error-page.js';
import { PageBlock } from '@/vdb/framework/layout-engine/page-layout.js';
import { Trans } from '@lingui/react/macro';
import { createFileRoute } from '@tanstack/react-router';

import { OrderDetailShared } from './components/order-detail-shared.js';
import { SellerOrdersCard } from './components/seller-orders-card.js';
import { loadRegularOrder } from './utils/order-detail-loaders.js';

export const Route = createFileRoute('/_authenticated/_orders/orders_/$id')({
    component: OrderDetailPage,
    staticData: {
        pendingSkeleton: {
            pageId: 'order-detail',
            blocks: [
                { column: 'main', blockId: 'order-table', content: 'table', rows: 3 },
                { column: 'main', blockId: 'payment-details', content: 'list', rows: 4, title: true },
                { column: 'main', blockId: 'fulfillment-details', content: 'list', rows: 4, title: true },
                { column: 'main', blockId: 'order-history', content: 'list', rows: 4, title: true },
                { column: 'side', blockId: 'customer', content: 'list', rows: 14, title: true },
                { column: 'side', blockId: 'tax-summary', content: 'list', rows: 2, title: true },
            ],
        },
    },
    loader: ({ context, params }) => loadRegularOrder(context, params),
    errorComponent: ({ error }) => <ErrorPage error={error} />,
});

function OrderDetailPage() {
    const params = Route.useParams();
    return (
        <OrderDetailShared
            pageId="order-detail"
            orderId={params.id}
            beforeOrderTable={order =>
                order.sellerOrders?.length ? (
                    <PageBlock column="main" blockId="seller-orders" title={<Trans>Seller orders</Trans>}>
                        <SellerOrdersCard orderId={params.id} />
                    </PageBlock>
                ) : undefined
            }
        />
    );
}
