import { ErrorPage } from '@/vdb/components/shared/error-page.js';
import { Badge } from '@/vdb/components/ui/badge.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Trans } from '@lingui/react/macro';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';

import { OrderDetail, OrderDetailShared } from './components/order-detail-shared.js';
import { loadSellerOrder } from './utils/order-detail-loaders.js';
import { getSeller } from './utils/order-utils.js';

export const Route = createFileRoute(
    '/_authenticated/_orders/orders_/$aggregateOrderId_/seller-orders/$sellerOrderId',
)({
    component: SellerOrderDetailPage,
    staticData: {
        pendingSkeleton: {
            pageId: 'seller-order-detail',
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
    loader: ({ context, params }) => loadSellerOrder(context, params),
    errorComponent: ({ error }) => <ErrorPage error={error} />,
});

function SellerOrderDetailPage() {
    const params = Route.useParams();

    const titleSlot = (order: OrderDetail) => {
        const seller = getSeller(order);
        return (
            <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" render={<Link
                        to="/orders/$aggregateOrderId"
                        params={{ aggregateOrderId: params.aggregateOrderId }}
                    />}>
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                {order.code ?? ''}
                <Badge variant="default">
                    <Trans>Seller order</Trans>
                </Badge>
                {seller && <Badge variant="outline">{seller.name}</Badge>}
            </div>
        );
    };

    return (
        <OrderDetailShared
            pageId="seller-order-detail"
            orderId={params.sellerOrderId}
            titleSlot={titleSlot}
        />
    );
}
