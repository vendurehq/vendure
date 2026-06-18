import { ErrorPage } from '@/vdb/components/shared/error-page.js';
import { PageBlock } from '@/vdb/framework/layout-engine/page-layout.js';
import { Trans } from '@lingui/react/macro';
import { createFileRoute } from '@tanstack/react-router';
import { OrderDetailShared } from './components/order-detail-shared.js';
import { SellerOrdersCard } from './components/seller-orders-card.js';
import { loadRegularOrder } from './utils/order-detail-loaders.js';

export const Route = createFileRoute('/_authenticated/_orders/orders_/$id')({
    component: OrderDetailPage,
    loader: ({ context, params }) => loadRegularOrder(context, params),
    errorComponent: ({ error }) => <ErrorPage message={error.message} />,
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
