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
    loader: ({ context, params }) => loadSellerOrder(context, params),
    errorComponent: ({ error }) => <ErrorPage message={error.message} />,
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
                <Badge variant="secondary">
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
