import { Alert, AlertDescription } from '@/vdb/components/ui/alert.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Skeleton } from '@/vdb/components/ui/skeleton.js';
import { Trans } from '@lingui/react/macro';
import { TriangleAlert } from 'lucide-react';
import { OrderHistory } from './order-history.js';
import { useOrderHistory } from './use-order-history.js';

interface OrderHistoryContainerProps {
    orderId: string;
}

export function OrderHistoryContainer({ orderId }: Readonly<OrderHistoryContainerProps>) {
    const {
        historyEntries,
        order,
        loading,
        error,
        addNote,
        updateNote,
        deleteNote,
        fetchNextPage,
        hasNextPage,
    } = useOrderHistory({ orderId, pageSize: 10 });

    if (loading && !order) {
        return (
            <div className="space-y-4">
                <h2 className="text-xl font-semibold">
                    <Trans>Order history</Trans>
                </h2>
                <div className="space-y-2">
                    <Skeleton className="h-20 w-full" />
                    <Skeleton className="h-24 w-full" />
                    <Skeleton className="h-24 w-full" />
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <Alert variant="destructive">
                <TriangleAlert className="h-4 w-4" />
                <AlertDescription>
                    <Trans>Error loading order history: {error.message}</Trans>
                </AlertDescription>
            </Alert>
        );
    }

    if (!order) {
        return (
            <Alert>
                <AlertDescription>
                    <Trans>Order not found</Trans>
                </AlertDescription>
            </Alert>
        );
    }

    return (
        <>
            {order ? (
                <OrderHistory
                    order={order}
                    historyEntries={historyEntries ?? []}
                    onAddNote={addNote}
                    onUpdateNote={updateNote}
                    onDeleteNote={deleteNote}
                />
            ) : null}
            {hasNextPage && (
                <Button type="button" variant="outline" onClick={() => fetchNextPage()}>
                    <Trans>Load more</Trans>
                </Button>
            )}
        </>
    );
}
