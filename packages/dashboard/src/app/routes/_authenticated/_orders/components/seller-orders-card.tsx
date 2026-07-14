import { DetailPageButton } from '@/vdb/components/shared/detail-page-button.js';
import { Badge } from '@/vdb/components/ui/badge.js';
import { api } from '@/vdb/graphql/api.js';
import { useDynamicTranslations } from '@/vdb/hooks/use-dynamic-translations.js';
import { useLocalFormat } from '@/vdb/hooks/use-local-format.js';
import { getTypeForState, stateTypeToBadgeVariant } from '@/vdb/utils/state-type.js';
import { useQuery } from '@tanstack/react-query';
import { sellerOrdersDocument } from '../orders.graphql.js';
import { getSeller } from '../utils/order-utils.js';

export interface SellerOrdersCardProps {
    orderId: string;
}

export function SellerOrdersCard({ orderId }: Readonly<SellerOrdersCardProps>) {
    const { formatCurrency } = useLocalFormat();
    const { getTranslatedOrderState } = useDynamicTranslations();
    const { data, isLoading, error } = useQuery({
        queryKey: ['seller-orders', orderId],
        queryFn: () => api.query(sellerOrdersDocument, { orderId }),
    });

    if (isLoading) {
        return (
            <div className="animate-pulse space-y-2">
                {Array.from({ length: 2 }).map((_, i) => (
                    <div key={i} className="h-16 bg-muted rounded-md" />
                ))}
            </div>
        );
    }

    if (error || !data?.order?.sellerOrders?.length) {
        return null;
    }

    return (
        <div className="flex flex-col gap-4 divide-y">
            {data.order.sellerOrders.map(sellerOrder => {
                const seller = getSeller(sellerOrder);

                return (
                    <div key={sellerOrder.id} className="p-3 -mx-3 pb-6 transition-colors">
                        <div className="flex justify-between items-center">
                            <DetailPageButton
                                label={sellerOrder.code}
                                href={`/orders/${orderId}/seller-orders/${sellerOrder.id}`}
                            />
                            <div className="text-sm font-medium">
                                {formatCurrency(sellerOrder.totalWithTax, sellerOrder.currencyCode)}
                            </div>
                        </div>
                        <div className="flex justify-between mt-1">
                            <div className="flex gap-2">
                                {seller && <Badge variant={'secondary'}>{seller.name}</Badge>}
                            </div>
                            <Badge variant={stateTypeToBadgeVariant(getTypeForState(sellerOrder.state))}>{getTranslatedOrderState(sellerOrder.state)}</Badge>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
